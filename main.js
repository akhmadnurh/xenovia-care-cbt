// ====================================================
// main.js — WEBHOOK ENTRY POINT (doPost)
// ====================================================

const doPost = (e) => {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.callback_query) {
      const {
        id: callbackId,
        message,
        data: callbackData,
      } = data.callback_query;
      const chatId = message.chat.id;
      PropertiesService.getScriptProperties().setProperty(
        "USER_CHAT_ID",
        String(chatId),
      );
      answerCallbackQuery(callbackId);

      if (["rekap_minggu", "rekap_bulan"].includes(callbackData)) {
        sendTelegramMessage(
          chatId,
          "⏳ *Sedang menganalisis data CBT...* Mohon tunggu sebentar.",
        );
        const type = callbackData === "rekap_minggu" ? "minggu" : "bulan";
        sendTelegramMessage(chatId, handleRekap(`/rekap ${type}`));
        return;
      }

      if (callbackData === "save_cbt_confirm") {
        const cache = CacheService.getUserCache();
        const pendingDataJson = cache.get(`PENDING_CBT_${chatId}`);
        if (pendingDataJson) {
          const cbtData = JSON.parse(pendingDataJson);
          saveToSheet(cbtData);
          saveToFirebase(cbtData);
          cache.remove(`PENDING_CBT_${chatId}`);
          cache.remove(`HISTORY_${chatId}`);
          cache.remove(`MODE_${chatId}`);
          sendTelegramMessage(
            chatId,
            "✅ Data CBT berhasil disimpan ke Google Sheets!",
          );
        } else {
          sendTelegramMessage(
            chatId,
            "ℹ️ Catatan CBT sudah disimpan sebelumnya atau sesi telah kadaluarsa.",
          );
        }
        return;
      }

      if (callbackData.startsWith("rf:")) {
        handleReframeCallback(chatId, callbackData);
        return;
      }

      if (callbackData.startsWith("stats_")) {
        const days = parseInt(callbackData.split("_")[1]) || 7;
        sendTelegramMessage(
          chatId,
          "⏳ *Sedang menganalisis data emosi...* Mohon tunggu sebentar.",
        );
        const stats = getEmotionStats(days);
        const freqText = stats.emotionFrequencies
          .map((e) => `${e.emotion}: ${e.count}x (${e.percentage}%)`)
          .join(", ");
        const statsSummary = `Periode: ${days} hari | Total sesi: ${stats.total} | Emosi dominan: ${stats.dominantEmotion} (${stats.dominantPercentage}%) | Rata-rata skala: ${stats.averageScale} | Frekuensi: ${freqText}`;
        const aiInsight = callGeminiForStats(statsSummary, days);
        sendTelegramMessage(chatId, formatStatsMessage(stats, days, aiInsight));
        return;
      }
    }

    const message = data.message;
    if (!message) return;
    const chatId = message.chat.id;
    PropertiesService.getScriptProperties().setProperty(
      "USER_CHAT_ID",
      String(chatId),
    );

    sendTypingAction(chatId);

    let userMessage = message.text ? message.text.trim() : "";
    if (message.voice || message.audio) {
      const voiceObj = message.voice || message.audio;
      const fileUrl = getTelegramFileUrl(voiceObj.file_id);
      if (fileUrl) {
        const transcribedText = transcribeAudioGroq(fileUrl);
        if (transcribedText)
          userMessage = userMessage
            ? `${userMessage} ${transcribedText}`
            : transcribedText;
      }
    }
    if (!userMessage) return;

    const pendingCbt = CacheService.getUserCache().get(`PENDING_CBT_${chatId}`);
    if (
      pendingCbt &&
      /^(iya|ya|iy|y|iyaa|simpan|save|yes|oke|ok)\b/i.test(userMessage.trim())
    ) {
      const cbtData = JSON.parse(pendingCbt);
      saveToSheet(cbtData);
      saveToFirebase(cbtData);
      const cache = CacheService.getUserCache();
      cache.remove(`PENDING_CBT_${chatId}`);
      cache.remove(`HISTORY_${chatId}`);
      cache.remove(`MODE_${chatId}`);
      sendTelegramMessage(
        chatId,
        "✅ Data CBT berhasil disimpan ke Google Sheets!",
      );
      return;
    }

    if (
      message.reply_to_message?.text?.includes("Kata Kunci Belum Dimasukkan")
    ) {
      sendTelegramMessage(
        chatId,
        "🔍 *Sedang mencari rekam jejak CBT masa lalu...* Mohon tunggu.",
      );
      sendTelegramMessage(chatId, handleCari(`/cari ${userMessage}`));
      return;
    }

    const lowerText = userMessage.toLowerCase();
    if (["/help", "/start"].includes(lowerText)) {
      sendTelegramMessage(chatId, getHelpText());
      return;
    }

    if (lowerText === "/reset") {
      const cache = CacheService.getUserCache();
      cache.remove(`HISTORY_${chatId}`);
      cache.remove(`PENDING_CBT_${chatId}`);
      cache.remove(`MODE_${chatId}`);
      const props = PropertiesService.getUserProperties();
      props.deleteProperty(`GROUNDING_STATE_${chatId}`);
      props.deleteProperty(`GROUNDING_ITEMS_${chatId}`);
      sendTelegramMessage(
        chatId,
        "🔄 *Sesi berhasil direset.* Ada cerita atau perasaan baru yang ingin kamu obrolkan?",
      );
      return;
    }

    if (lowerText === "/anchor") {
      executeAnchorFlow(chatId);
      return;
    }

    if (lowerText.startsWith("/reframe")) {
      handleReframeCommand(chatId);
      return;
    }

    if (lowerText === "/win") {
      const record = getRandomWinRecord();
      if (!record) {
        sendTelegramMessage(
          chatId,
          "ℹ️ Belum ada catatan positif dalam 30 hari terakhir di Google Sheets.",
        );
        return;
      }
      sendTelegramMessage(
        chatId,
        "🏆 *Mengambil catatan kemenanganmu dari jurnal...*",
      );
      const narrative = generateWinNarrative(record);
      sendTelegramMessage(chatId, narrative || formatWinFallback(record));
      return;
    }

    if (lowerText === "/stats") {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "📊 Rekap Minggu (7 Hari)", callback_data: "stats_7" },
            { text: "📅 Rekap Bulan (30 Hari)", callback_data: "stats_30" },
          ],
        ],
      };
      sendTelegramMessage(
        chatId,
        "📊 *Pilih Periode Statistik Emosi*\n\nSilakan pilih periode data statistik yang ingin kamu lihat:",
        keyboard,
      );
      return;
    }

    var cleanText = userMessage
      .trim()
      .split(" ")[0]
      .split("@")[0]
      .toLowerCase();
    if (cleanText === "/grounding") {
      handleStartGrounding(chatId);
      return;
    }

    if (cleanText === "/breathing") {
      handleBreathing(chatId);
      return;
    }

    // Grounding state bypass — route to Gemini, bypass DeepSeek CBT engine
    const props = PropertiesService.getUserProperties();
    const groundingState = props.getProperty(`GROUNDING_STATE_${chatId}`);
    if (groundingState) {
      const reply = processGroundingStep(chatId, userMessage, groundingState);
      sendTelegramMessage(chatId, reply);
      return;
    }

    if (lowerText.startsWith("/rekap")) {
      if (lowerText === "/rekap") {
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "📊 Rekap Minggu (7 Hari)",
                callback_data: "rekap_minggu",
              },
              {
                text: "📅 Rekap Bulan (30 Hari)",
                callback_data: "rekap_bulan",
              },
            ],
          ],
        };
        sendTelegramMessage(
          chatId,
          "🗓️ *Pilih Periode Rekap CBT*\n\nSilakan pilih periode yang ingin kamu analisis:",
          keyboard,
        );
      } else {
        sendTelegramMessage(
          chatId,
          "⏳ *Sedang menganalisis data CBT...* Mohon tunggu sebentar.",
        );
        sendTelegramMessage(chatId, handleRekap(userMessage));
      }
      return;
    }

    if (lowerText.startsWith("/cari")) {
      const query = userMessage.replace("/cari", "").trim();
      if (!query) {
        sendTelegramMessage(
          chatId,
          "🔍 *Kata Kunci Belum Dimasukkan*\n\nKetik kata kunci yang ingin dicari.",
          { force_reply: true, selective: true },
        );
      } else {
        sendTelegramMessage(
          chatId,
          "🔍 *Sedang mencari rekam jejak CBT masa lalu...* Mohon tunggu.",
        );
        sendTelegramMessage(chatId, handleCari(userMessage));
      }
      return;
    }

    const reply = processCBT_Engine(chatId, userMessage);
    if (reply.isComplete && reply.cbtData) {
      const cache = CacheService.getUserCache();
      cache.put(
        `PENDING_CBT_${chatId}`,
        JSON.stringify(reply.cbtData),
        CACHE_TTL_SECONDS,
      );
      const saveKeyboard = {
        inline_keyboard: [
          [
            {
              text: "💾 Simpan ke Google Sheets",
              callback_data: "save_cbt_confirm",
            },
          ],
        ],
      };
      sendTelegramMessage(chatId, reply.userMessage, saveKeyboard);
    } else {
      if (/RANGKUMAN REFLEKSI CBT/i.test(reply.userMessage)) {
        const saveKeyboard = {
          inline_keyboard: [
            [
              {
                text: "💾 Simpan ke Google Sheets",
                callback_data: "save_cbt_confirm",
              },
            ],
          ],
        };
        sendTelegramMessage(chatId, reply.userMessage, saveKeyboard);
      } else {
        sendTelegramMessage(chatId, reply.userMessage);
      }
    }
  } catch (err) {
    Logger.log(`Error in doPost: ${err}`);
  }
};

const sendDailyAnchor = () => {
  const chatId =
    PropertiesService.getScriptProperties().getProperty("USER_CHAT_ID");
  if (!chatId) {
    Logger.log("USER_CHAT_ID belum tersimpan di Script Properties.");
    return;
  }
  executeAnchorFlow(chatId);
};
