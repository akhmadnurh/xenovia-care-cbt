// ====================================================
// main.js — WEBHOOK ENTRY POINT (doPost) & WEB APP (doGet)
// ====================================================

function doGet(e) {
  const page = e && e.parameter && e.parameter.page;
  if (page === "breathing") {
    return HtmlService.createHtmlOutputFromFile("Breathing")
      .setTitle("Latihan Napas Interaktif")
      .addMetaTag(
        "viewport",
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      )
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile("index")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle("Xenovia Care");
}

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
      answerCallbackQuery(callbackId, "Memproses...");

      if (["rekap_minggu", "rekap_bulan"].includes(callbackData)) {
        sendTypingAction(chatId);
        sendTelegramMessage(
          chatId,
          "⏳ *Sedang menganalisis data CBT...* Mohon tunggu sebentar.",
        );
        const type = callbackData === "rekap_minggu" ? "minggu" : "bulan";
        sendTelegramMessage(chatId, handleRekap(`/rekap ${type}`));
        return;
      }

      if (callbackData === "save_cbt_confirm") {
        sendTypingAction(chatId);
        const cache = CacheService.getUserCache();
        const pendingDataJson = cache.get(`PENDING_CBT_${chatId}`);
        if (pendingDataJson) {
          const cbtData = JSON.parse(pendingDataJson);
          saveToSheet(cbtData);
          saveToFirebase(cbtData);
          const historyJson = cache.get(`HISTORY_${chatId}`);
          cache.remove(`PENDING_CBT_${chatId}`);
          cache.remove(`HISTORY_${chatId}`);
          cache.remove(`MODE_${chatId}`);
          sendTelegramMessage(
            chatId,
            "✅ Data CBT berhasil disimpan ke Google Sheets!",
          );
          if (historyJson) {
            generateAndSaveCbtMemory(chatId, JSON.parse(historyJson));
          }
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
        sendTypingAction(chatId);
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
        flowLog("voice", `transcribe ${transcribedText ? "OK" : "GAGAL"}`);
      } else {
        flowLog("voice", "fileUrl kosong");
      }
    }
    if (!userMessage) return;

    const userCache = CacheService.getUserCache();
    const pendingCbt = userCache.get(`PENDING_CBT_${chatId}`);
    // Jev gate — satu callJev per pesan bebas; slash command dilewati (intent sudah eksplisit).
    // null = Jev gagal → tiap poin di bawah otomatis balik ke jalur lama.
    const isSlashCmd = userMessage.startsWith("/");
    if (isSlashCmd) flowLog("gate", "skip (slash command)");
    const gate = isSlashCmd
      ? null
      : runMessageGate(
          chatId,
          userMessage,
          userCache.get(`MODE_${chatId}`) ?? "PURE_LISTENING",
          !!pendingCbt,
        );

    // 1) Krisis — override segalanya (balasan statis, tanpa LLM)
    if (gate && gate.crisis >= JEV_THRESHOLD.crisis) {
      flowLog("route", `⛔ CRISIS (${gate.crisis}) → balas statis`);
      sendTelegramMessage(chatId, CRISIS_MESSAGE);
      return;
    }

    // 2) Konfirmasi simpan — Jev bila tersedia; regex lama tetap fallback saat Jev null
    const confirmedSave =
      pendingCbt &&
      (gate
        ? gate.save >= JEV_THRESHOLD.save
        : /^(iya|ya|iy|y|iyaa|simpan|save|yes|oke|ok)\b/i.test(
            userMessage.trim(),
          ));
    if (pendingCbt) {
      flowLog(
        "route",
        confirmedSave
          ? `💾 simpan via ${gate ? `jev(${gate.save})` : "regex"}`
          : `pending CBT ada, belum konfirm (save=${gate ? gate.save : "n/a"})`,
      );
    }
    if (confirmedSave) {
      const cbtData = JSON.parse(pendingCbt);
      saveToSheet(cbtData);
      saveToFirebase(cbtData);
      const cache = CacheService.getUserCache();
      const historyJson = cache.get(`HISTORY_${chatId}`);
      cache.remove(`PENDING_CBT_${chatId}`);
      cache.remove(`HISTORY_${chatId}`);
      cache.remove(`MODE_${chatId}`);
      sendTelegramMessage(
        chatId,
        "✅ Data CBT berhasil disimpan ke Google Sheets!",
      );
      if (historyJson) {
        generateAndSaveCbtMemory(chatId, JSON.parse(historyJson));
      }
      return;
    }

    // 3) Mode writeback 2-arah: gate bilang "story" & percaya diri, mode sekarang CBT
    //    → buka lagi PURE_LISTENING (arah CBT→cerita hanya bisa dari gate; cerita→CBT tetap via tag model)
    if (
      gate &&
      gate.mode === "story" &&
      gate.modeConfidence >= JEV_THRESHOLD.mode &&
      userCache.get(`MODE_${chatId}`) === "CBT_EVALUATOR"
    ) {
      userCache.put(`MODE_${chatId}`, "PURE_LISTENING", CACHE_TTL_SECONDS);
      flowLog("mode", `CBT → PURE_LISTENING (conf=${gate.modeConfidence})`);
    }

    if (
      message.reply_to_message?.text?.includes("Kata Kunci Belum Dimasukkan")
    ) {
      flowLog("route", "reply-to search → handleCari");
      sendTelegramMessage(
        chatId,
        "🔍 *Sedang mencari rekam jejak CBT masa lalu...* Mohon tunggu.",
      );
      sendTelegramMessage(chatId, handleCari(`/cari ${userMessage}`));
      return;
    }

    const lowerText = userMessage.toLowerCase();
    if (lowerText.startsWith("/")) flowLog("cmd", lowerText);
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

    let cleanText = userMessage
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

    if (cleanText === "/fokus_luar") {
      handleStartAttentionShift(chatId);
      return;
    }

    // Grounding state bypass — route to Gemini, bypass CBT engine (callMainAI)
    const props = PropertiesService.getUserProperties();
    const groundingState = props.getProperty(`GROUNDING_STATE_${chatId}`);
    if (groundingState) {
      flowLog("route", "grounding bypass");
      const reply = processGroundingStep(chatId, userMessage, groundingState);
      sendTelegramMessage(chatId, reply);
      return;
    }

    // Attention shift state bypass
    const attentionState = props.getProperty(`ATTENTION_STATE_${chatId}`);
    if (attentionState) {
      flowLog("route", "attention bypass");
      const reply = processAttentionShiftStep(
        chatId,
        userMessage,
        attentionState,
      );
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

    // Recall on-demand: hanya saat Jev bilang pesan merujuk kejadian lampau
    const recallOn = gate && gate.recall >= JEV_THRESHOLD.recall;
    const recallContext = recallOn ? buildRecallContext(userMessage) : "";
    flowLog(
      "recall",
      recallOn ? `ON → ${recallContext ? "ada hasil" : "tanpa hasil"}` : "off",
    );
    const reply = processCBT_Engine(chatId, userMessage, recallContext);
    if (reply.isComplete && reply.cbtData) {
      flowLog("cbt", "COMPLETE → menunggu konfirmasi simpan");
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
    flowLog("error", err?.message ?? String(err));
    Logger.log(`Error in doPost: ${err}`);
    try {
      const data = JSON.parse(e.postData.contents);
      const chatId =
        data.callback_query?.message?.chat?.id || data.message?.chat?.id;
      if (chatId) {
        sendTelegramMessage(
          chatId,
          "⚠️ Sistem sedang mengalami kendala jaringan singkat, tetapi catatanmu tetap aman. Silakan coba beberapa saat lagi.",
        );
      }
    } catch (fallbackErr) {
      Logger.log(`Fallback message also failed: ${fallbackErr}`);
    }
  } finally {
    let finalChatId = "-";
    try {
      const data = JSON.parse(e.postData.contents);
      finalChatId =
        data.callback_query?.message?.chat?.id || data.message?.chat?.id || "-";
    } catch (ignored) {
      /* payload tidak valid */
    }
    flushFlowLog(finalChatId);
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
