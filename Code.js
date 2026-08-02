// ====================================================
// SECTION 1: CONFIGURATION & CONSTANTS
// ====================================================
const TELEGRAM_TOKEN = CONFIG.TELEGRAM_TOKEN;
const GROQ_API_KEY = CONFIG.GROQ_API_KEY;
const GEMINI_API_KEY = CONFIG.GEMINI_API_KEY;
const OPENROUTER_API_KEY = CONFIG.OPENROUTER_API_KEY;

const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const TELEGRAM_SEND_MESSAGE_URL = `${TELEGRAM_BASE_URL}/sendMessage`;
const TELEGRAM_ANSWER_CALLBACK_URL = `${TELEGRAM_BASE_URL}/answerCallbackQuery`;

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const CACHE_TTL_SECONDS = 21600;

const GROUNDING_STEPS = [
  "STEP_5_SEE",
  "STEP_4_FEEL",
  "STEP_3_HEAR",
  "STEP_2_SMELL",
  "STEP_1_TASTE",
];
const GROUNDING_LABELS = {
  STEP_5_SEE: {
    label: "👁️ 5 Hal yang Kamu Lihat",
    target: 5,
    verb: "lihat",
    detail: "sebut benda + detail visual (warna, bentuk, ukuran)",
  },
  STEP_4_FEEL: {
    label: "✋ 4 Hal yang Kamu Rasakan",
    target: 4,
    verb: "sentuh/rasakan",
    detail: "sebut objek + tekstur/suhu (kasar, halus, dingin, hangat)",
  },
  STEP_3_HEAR: {
    label: "👂 3 Suara yang Kamu Dengar",
    target: 3,
    verb: "dengar",
    detail: "sebut sumber suara (kipas, kendaraan, suara hewan)",
  },
  STEP_2_SMELL: {
    label: "👃 2 Bau yang Kamu Cium",
    target: 2,
    verb: "cium",
    detail: "sebut aroma spesifik (wangi parfum, bau makanan, udara netral)",
  },
  STEP_1_TASTE: {
    label: "👅 1 Rasa yang Kamu Kecap",
    target: 1,
    verb: "kecap",
    detail: "sebut rasa spesifik di mulut (asin, manis, pahit, netral)",
  },
};

const DAY_NAMES = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const VALID_CATEGORIES = [
  "Kecemasan",
  "Kemarahan",
  "Positif",
  "Kesedihan",
  "Stres",
];

// ====================================================
// SECTION 2: MAIN WEBHOOK & ENTRY POINTS
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

      if (callbackData.startsWith("rf_")) {
        handleReframeCallback(chatId, callbackData);
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

    var cleanText = userMessage
      .trim()
      .split(" ")[0]
      .split("@")[0]
      .toLowerCase();
    if (cleanText === "/grounding") {
      handleStartGrounding(chatId);
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

// ====================================================
// SECTION 3: FEATURES & COMMAND HANDLERS
// ====================================================
const getHelpText = () => `🌿 *PANDUAN XENOVIA CARE (CBT BOT)*

*Alur Percakapan Jurnal CBT:*
1. *Fase Menyimak:* Ceritakan pengalamanmu sepuasnya tanpa gangguan.
2. *Fase Bedah CBT:* Setelah cerita selesai, AI akan membimbing evaluasi pikiran & emosi.

📌 *DAFTAR PERINTAH*:
• \`/help\` - Menampilkan panduan.
• \`/reset\` - Memulai ulang sesi.
• \`/anchor\` - Kirim & pin Pegangan Utama (Morning Anchor).
• \`/reframe\` - P3K Reframing Instan (Tombol topik dinamis).
• \`/rekap minggu / bulan\` - Rekap histori CBT.
• \`/cari <kata_kunci>\` - Cari rekam jejak.
• \`/grounding\` - Teknik 5-4-3-2-1 Sensory Grounding (meredakan cemas instan).`;

const executeAnchorFlow = (chatId) => {
  const negRows = getNegativeRowsLastNDays(30);
  let distilledSentence =
    "Aku tahu rasa waswas ini cuma sinyal tubuh yang terlalu peka, bukan bahaya nyata. Tubuhku aman, sehat, dan aku pegang kendali penuh.";

  if (negRows.length > 0) {
    const promptDistill = `Kamu adalah Xenovia Care, asisten CBT.
Berikut adalah beberapa catatan Pikiran Seimbang (reframing) pengguna terkait isu pemicu utama kecemasan dalam 30 hari terakhir:
${JSON.stringify(
  negRows.map((r) => r.pikiranSeimbang),
  null,
  2,
)}

TUGAS UTAMA:
Suling/ringkas data Pikiran Seimbang di atas menjadi 1 KALIMAT SAKTI UTAMA untuk afirmasi pagi pengguna.

ATURAN KETAT (HARAM MELENCENG):
1. WAJIB menggunakan sudut pandang orang pertama ("Aku...").
2. Kalimat harus simpel, sangat humanis, hangat, dan mudah dibaca saat baru bangun tidur.
3. DILARANG KERAS menggunakan tanda baca em-dash atau dua strip (--)!
4. DILARANG KERAS menggunakan kata "hari ini"!
5. Hanya berikan 1 KALIMAT SAKTI saja tanpa salam, tanpa narasi, dan tanpa tanda petik berlebih.`;

    const aiRes = callGemini(promptDistill, 0.3);
    if (aiRes && aiRes.trim() !== "") {
      distilledSentence = sanitizeQuotes(aiRes);
    }
  }

  const widgetSs = SpreadsheetApp.getActiveSpreadsheet();
  let widgetSheet =
    widgetSs.getSheetByName("Widget_Anchor") ??
    widgetSs.insertSheet("Widget_Anchor");
  widgetSheet.getRange("A1").setValue(sanitizeQuotes(distilledSentence));
  const { dateStr, timeStr } = formatTimestampJakarta();
  widgetSheet.getRange("B1").setValue(`Last Update: ${dateStr} ${timeStr}`);

  const promptGreeting = `Kamu adalah Xenovia Care, teman dekat yang sangat hangat, ramah, realistis, dan empatis.
Buatkan 2-3 KALIMAT SAPAAN/PENYEMANGAT PAGI YANG BERVARIASI DAN HANGAT untuk pengguna yang baru bangun tidur di pagi hari sebelum sholat Subuh.

ATURAN KETAT:
1. Panjang wajib 2 hingga 3 kalimat yang terasa lega, santai, membumi, dan menguatkan.
2. DILARANG KERAS menggunakan panggilan atau kata-kata cringey/pujangga (seperti "kesayangan", "peluk jauh", "dekap", dsb.).
3. DILARANG KERAS menggunakan gaya bahasa kaku CS bank.
4. DILARANG KERAS menggunakan kata "hari ini" secara berlebihan.
5. Cukup 2-3 kalimat mengalir alami tanpa header/emoji berlebih.`;

  let morningGreeting =
    "Selamat pagi! Bangun tidur dengan tenang ya. Ingat, kamu sudah melangkah sejauh ini dan selalu berhasil melewati setiap rasa cemas dengan baik. Tubuh dan pikiranmu sebenarnya jauh lebih tangguh dari apa yang sering kamu khawatirkan.";
  const greetingRes = callGemini(promptGreeting, 0.7);
  if (greetingRes && greetingRes.trim() !== "")
    morningGreeting = greetingRes.trim();

  const anchorText = `🌅 *Selamat pagi!*

${morningGreeting}

💡 *Pegangan Utama Hari Ini:*
"${distilledSentence}"`;

  unpinAllTelegramMessages(chatId);
  const sentRes = sendTelegramMessage(chatId, anchorText);
  if (sentRes?.ok && sentRes?.result?.message_id)
    pinTelegramMessage(chatId, sentRes.result.message_id);
};

const handleReframeCommand = (chatId) => {
  const negRows = getNegativeRowsLastNDays(30);

  if (negRows.length === 0) {
    sendTelegramMessage(
      chatId,
      "ℹ️ Belum ada catatan CBT emosi negatif dalam 30 hari terakhir di Google Sheets.",
    );
    return;
  }

  const promptExtract = `Analisis daftar Peristiwa & Pikiran Otomatis dari jurnal emosi negatif/kecemasan pengguna (30 hari terakhir):
${JSON.stringify(
  negRows.map((r) => ({ peristiwa: r.peristiwa, pikiran: r.pikiranOtomatis })),
  null,
  2,
)}

TUGAS UTAMA:
Identifikasi dan kelompokkan menjadi 4 hingga 6 TOPIK/PEMICU SPESIFIK yang paling sering diulang-ulang oleh pengguna (misal: "Sensasi Lambung", "Detak Jantung", "Makan Pedas", "Deadline Kerja", "Overthinking").

ATURAN OUTPUT:
Wajib HANYA mengembalikan JSON Array string berisi 4 hingga 6 topik spesifik tersebut. Setiap nama topik MAKSIMAL 2-3 kata dan beri 1 emoji pemicu di depannya.
Contoh: ["🤢 Sensasi Lambung", "🫀 Detak Jantung", "💼 Deadline Kerja", "🧠 Overthinking"]`;

  let topics = [
    "🤢 Sensasi Lambung",
    "🫀 Sensasi Fisik",
    "💼 Pekerjaan & Tugas",
    "🧠 Overthinking",
  ];
  const aiTopicRes = callGemini(promptExtract, 0.2);
  if (aiTopicRes) {
    try {
      const jsonMatch = aiTopicRes.match(/\[[\s\S]*?\]/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0)
          topics = parsed.slice(0, 6);
      }
    } catch (err) {
      Logger.log(`Topic Parsing Error: ${err}`);
    }
  }

  const inlineKeyboard = [];
  for (let i = 0; i < topics.length; i += 2) {
    const row = [];
    const top1 = topics[i];
    const cleanKw1 = top1
      .replace(/[^\w\s]/gi, "")
      .trim()
      .slice(0, 15);
    row.push({ text: top1, callback_data: `rf_tp_${cleanKw1}` });
    if (i + 1 < topics.length) {
      const top2 = topics[i + 1];
      const cleanKw2 = top2
        .replace(/[^\w\s]/gi, "")
        .trim()
        .slice(0, 15);
      row.push({ text: top2, callback_data: `rf_tp_${cleanKw2}` });
    }
    inlineKeyboard.push(row);
  }
  inlineKeyboard.push([
    { text: "🎲 Random / Acak", callback_data: "rf_random" },
  ]);
  sendTelegramMessage(
    chatId,
    "🌿 *P3K Reframing Instan*\n\nSilakan pilih topik atau pemicu spesifik yang ingin kamu baca saat ini:",
    { inline_keyboard: inlineKeyboard },
  );
};

const handleReframeCallback = (chatId, callbackData) => {
  const negRows = getNegativeRowsLastNDays(30);
  if (negRows.length === 0) {
    sendTelegramMessage(chatId, "ℹ️ Belum ada catatan reframing tersedia.");
    return;
  }
  let selectedRows = [];
  if (callbackData === "rf_random") {
    selectedRows = [...negRows].sort(() => 0.5 - Math.random()).slice(0, 2);
  } else if (callbackData.startsWith("rf_tp_")) {
    const topicKey = callbackData.replace("rf_tp_", "").toLowerCase();
    const matched = negRows.filter((r) => {
      const fullText =
        `${r.peristiwa} ${r.pikiranOtomatis} ${r.buktiTandingan}`.toLowerCase();
      const words = topicKey.split(/\s+/).filter((w) => w.length > 2);
      return words.some((w) => fullText.includes(w));
    });
    selectedRows = matched.length > 0 ? matched.slice(-3) : negRows.slice(-2);
  }
  let messageText = `💡 *Reframing Masa Lalu*\n\n`;
  selectedRows.forEach((r) => {
    messageText += `• *${r.pikiranSeimbang}*\n\n`;
  });
  sendTelegramMessage(chatId, messageText.trim());
};

// --- Grounding Technique Handler ---

const handleStartGrounding = (chatId) => {
  try {
    const props = PropertiesService.getUserProperties();
    props.setProperty(`GROUNDING_STATE_${chatId}`, "STEP_5_SEE");
    props.setProperty(`GROUNDING_ITEMS_${chatId}`, "[]");

    const msg = `🌿 *Teknik Grounding 5-4-3-2-1*

Teknik ini membantu menenangkan sistem sarafmu dengan menghubungkan kembali pikiran ke lingkungan sekitar melalui panca indera.

Mari kita mulai!

*${GROUNDING_LABELS.STEP_5_SEE.label}*

Sebutkan 5 benda yang kamu lihat di sekitarmu saat ini.
✨ Setiap benda WAJIB disertai deskripsi visualnya ya.
Contoh: *"Daun mangga berwarna hijau tua"*, *"Bantal sofa berwarna krem"*, *"Lampu kamar berbentuk bulat"*`;

    sendTelegramMessage(chatId, msg);
  } catch (err) {
    Logger.log(`Grounding start error: ${err}`);
    sendTelegramMessage(
      chatId,
      "Gagal memulai sesi grounding, silakan coba lagi.",
    );
  }
};

const processGroundingStep = (chatId, userMessage, currentStep) => {
  const props = PropertiesService.getUserProperties();
  const itemsJson = props.getProperty(`GROUNDING_ITEMS_${chatId}`) ?? "[]";
  const items = JSON.parse(itemsJson);

  const stepInfo = GROUNDING_LABELS[currentStep];
  const targetCount = stepInfo.target;

  const evaluationPrompt = `Kamu adalah Evaluator Teknik Grounding 5-4-3-2-1 yang ketat dan teliti.

LANGKAH SAAT INI: ${stepInfo.label}
TARGET: Sebutkan ${targetCount} objek/hal dengan deskripsi detail.
PETUNJUK DESKRIPSI: ${stepInfo.detail}

TUGAS:
1. Evaluasi jawaban user di bawah ini.
2. Ekstrak item-item VALID & DESKRIPTIF dari jawaban user ke dalam JSON Array of strings.
3. Aturan validasi:
   - HANYA item yang menyertakan deskripsi/detail spesifik yang valid.
   - TOLAK item yang hanya menyebutkan nama benda singkat (misal: "daun", "meja", "kipas").
   - Untuk STEP_5_SEE: Wajib ada detail visual (warna, bentuk, ukuran, posisi).
   - Untuk STEP_4_FEEL: Wajib ada tekstur/suhu (kasar, halus, dingin, hangat, lembut).
   - Untuk STEP_3_HEAR: Wajib sebut sumber suara (bunyi AC, suara kendaraan, suara kucing).
   - Untuk STEP_2_SMELL: Wajib sebut aroma spesifik (wangi lavender, bau gorengan, udara ruangan netral).
   - Untuk STEP_1_TASTE: Wajib sebut rasa spesifik (asin, manis, pahit, sepat, netral).
4. Jika item sudah ada di daftar yang sudah terkumpul sebelumnya, jangan duplikat.
5. Gabungkan item baru yang valid dengan item yang sudah ada.

ITEM SEBELUMNYA: ${JSON.stringify(items)}

JAWABAN USER: "${userMessage}"

Keluarkan JSON dengan format EXACT berikut (hanya JSON, tanpa markdown, tanpa pembungkus):
{ "valid_items": ["item1", "item2"], "total_valid": number, "is_complete": boolean, "feedback": "string pesan untuk user" }

Aturan:
- "valid_items": array item baru yang valid + item sebelumnya (gabungan)
- "total_valid": jumlah total item valid setelah digabung
- "is_complete": true jika total_valid >= ${targetCount}
- "feedback":
  * Jika ada item yang ditolak (tanpa deskripsi), beritahu item mana dan minta deskripsikan ulang.
  * Jika total_valid < ${targetCount}, beri semangat dan minta user menyebutkan ${targetCount - items.length} sisanya dengan deskripsi.
  * Jika is_complete = true, beri apresiasi singkat.`;

  let validItems = [...items];
  let isComplete = false;
  let feedback =
    "Terima kasih! Bisa sebutkan lagi dengan deskripsi yang lebih detail?";

  const aiRes = callGemini(evaluationPrompt, 0.2);
  try {
    const jsonMatch = aiRes.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      validItems = parsed.valid_items ?? validItems;
      isComplete = parsed.is_complete ?? false;
      feedback = parsed.feedback ?? feedback;
    }
  } catch (err) {
    Logger.log(`Grounding parse error: ${err}`);
  }

  props.setProperty(`GROUNDING_ITEMS_${chatId}`, JSON.stringify(validItems));

  if (isComplete) {
    const stepIndex = GROUNDING_STEPS.indexOf(currentStep);
    if (stepIndex < GROUNDING_STEPS.length - 1) {
      const nextStep = GROUNDING_STEPS[stepIndex + 1];
      props.setProperty(`GROUNDING_STATE_${chatId}`, nextStep);
      return `✅ *Bagus!* Langkah ${currentStep.replace("STEP_", "").replace("_", " ").toLowerCase()} selesai! ${feedback}

Sekarang lanjut ke langkah berikutnya:

*${GROUNDING_LABELS[nextStep].label}*

Sebutkan ${GROUNDING_LABELS[nextStep].target} hal yang kamu ${GROUNDING_LABELS[nextStep].verb}.
✨ ${GROUNDING_LABELS[nextStep].detail}`;
    } else {
      props.deleteProperty(`GROUNDING_STATE_${chatId}`);
      props.deleteProperty(`GROUNDING_ITEMS_${chatId}`);
      return `🌟 *Grounding 5-4-3-2-1 Selesai!*

Kamu berhasil menenangkan sistem sarafmu dengan menghubungkan kembali kesadaran ke lingkungan sekitar. Semoga perasaanmu lebih tenang dan stabil sekarang. 🧘‍♂️

Kapan saja cemas datang lagi, kamu bisa ulangi teknik ini kapanpun. Aku akan selalu siap mendengarkan ceritamu 💙`;
    }
  }

  return feedback;
};

const handleRekap = (userMessage) => {
  const parts = userMessage.split(" ");
  const type = parts[1]?.toLowerCase() ?? "minggu";
  const daysLimit = type === "bulan" ? 30 : 7;
  const collectedRows = getRowsLastNDays(daysLimit);
  if (collectedRows.length === 0)
    return `ℹ️ Belum ada catatan CBT dalam *${daysLimit} hari terakhir* di Google Sheets.`;

  const prompt = `Kamu adalah Asisten Analis Psikologi CBT. Analisis seluruh data catatan CBT pengguna (${daysLimit} hari terakhir):
${JSON.stringify(collectedRows, null, 2)}

SANGAT PENTING - ATURAN TIPOGRAFI & READABILITY TELEGRAM:
- DILARANG KERAS MENGGUNAKAN SIMBOL HEADER SEPERTI '###' ATAU '##'.
- WAJIB gunakan newline asli (\\n\\n) — TULISKAN SEBAGAI ENTER/LINE BREAK ASLI, jangan pakai teks literal backslash-n.
- Gunakan kombinasi Emoji, Teks Tebal (*Judul Bagian*), spasi ganda antar paragraf, dan bullet points (•).
- Tulisan harus terasa lega, empati, hangat, dan tidak melelahkan mata saat dibaca di HP.

Struktur Balasan:
🌿 *Rekap Evaluasi CBT (${daysLimit} Hari Terakhir)*

📊 *1. Ringkasan Sesi*
(Total catatan & dinamika emosi secara ringkas)

⚡ *2. Pemicu Utama (Triggers)*
(Gunakan bullet points • untuk menjabarkan pemicu fisik/mental)

🧠 *3. Analisis Pola Distorsi Kognitif*
(Distorsi yang paling sering muncul & maknanya)

🌱 *4. Evaluasi Reframing & Kemajuan*
(Apresiasi pikiran seimbang yang berhasil dibuat)

💙 *5. Pesan Penguatan*
(Kalimat penutup yang hangat)`;
  return callGemini(prompt, 0.3);
};

const handleCari = (userMessage) => {
  const query = userMessage.replace("/cari", "").trim();
  if (!query)
    return "⚠️ Mohon sertakan kata kunci pencarian.\n*Contoh:* `/cari lambung` atau `/cari cemas rapat`";
  const keywords = query.toLowerCase().split(/\s+/);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const matchedRows = sheets.flatMap((sheet) => {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    return data
      .slice(1)
      .filter((row) => {
        const rowDate = parseDateFromSheet(row[0]);
        if (!rowDate || rowDate < cutoffDate) return false;
        return keywords.every((kw) => row.join(" ").toLowerCase().includes(kw));
      })
      .map((row) => ({
        tanggal: row[0],
        peristiwa: row[1],
        pikiranOtomatis: row[2],
        emosi: row[3],
        distorsi: row[4],
        buktiTandingan: row[5],
        pikiranSeimbang: row[6],
        kategori: row[7],
      }));
  });

  if (matchedRows.length === 0)
    return `ℹ️ Tidak ditemukan catatan CBT terkait *"${query}"* dalam 1 tahun terakhir di Google Sheets.`;
  const prompt = `Kamu adalah Xenovia Care, asisten CBT. Pengguna mencari rekam jejak kata kunci: "${query}".
Ditemukan total ${matchedRows.length} kali dalam 1 tahun terakhir. Ini ${matchedRows.slice(-10).length} catatan terbaru utuh:
${JSON.stringify(matchedRows.slice(-10), null, 2)}

SANGAT PENTING - ATURAN TIPOGRAFI & READABILITY TELEGRAM:
- DILARANG KERAS MENGGUNAKAN SIMBOL HEADER SEPERTI '###' ATAU '##'.
- DILARANG KERAS MENGGUNAKAN KALIMAT SAPAAN BASI DI AWAL PARAGRAF. LANGSUNG MASUK KE ISI LAPORAN!
- WAJIB gunakan newline asli (\\n\\n) — TULISKAN SEBAGAI ENTER/LINE BREAK ASLI, jangan pakai teks literal backslash-n.
- Gunakan kombinasi Emoji, Teks Tebal (*Judul Bagian*), spasi ganda antar paragraf, dan bullet points (•).
- Tulisan harus terasa lega, tidak padat menumpuk, dan nyaman dibaca saat cemas.

Struktur Balasan:
🔍 *Rekam Jejak CBT: "${query}"*

💙 *1. Perjalanan & Frekuensi*
(Penjelasan hangat bahwa topik ini sudah berhasil dilewati total ${matchedRows.length} kali).

🔗 *2. Analisis Pemicu & Korelasi*
(Sintesis singkat hubungan sebab-akibat antar pemicu).

💡 *3. Gudang Reframing Masa Lalu*
(Gunakan bullet points • untuk menampilkan Pikiran Seimbang paling ampuh yang pernah ditulis pengguna dulu).`;
  return callGemini(prompt, 0.3);
};

// ====================================================
// SECTION 4: CBT ENGINE & PROMPT MODULES
// ====================================================
const processCBT_Engine = (chatId, userMessage) => {
  const cache = CacheService.getUserCache();
  let history = JSON.parse(cache.get(`HISTORY_${chatId}`) ?? "[]");
  let currentMode = cache.get(`MODE_${chatId}`) ?? "PURE_LISTENING";
  history.push({ role: "user", content: userMessage });

  const { dayName, dateStr, timeStr } = formatTimestampJakarta();
  const systemPrompt =
    currentMode === "PURE_LISTENING"
      ? getPureListenerPrompt(dayName, dateStr, timeStr)
      : getCbtEvaluatorPrompt(dayName, dateStr, timeStr);
  const messagesPayload = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  let aiText = callDeepSeek(messagesPayload, 0.4);
  aiText = sanitizeAIResponse(aiText);

  if (
    currentMode === "PURE_LISTENING" &&
    aiText?.includes("<<<TRANSITION_TO_CBT>>>")
  ) {
    aiText = aiText.replace("<<<TRANSITION_TO_CBT>>>", "").trim();
    cache.put(`MODE_${chatId}`, "CBT_EVALUATOR", CACHE_TTL_SECONDS);
  }

  let isComplete = false;
  let cbtData = null;
  if (aiText?.includes("<<<CBT_COMPLETE>>>")) {
    isComplete = true;
    const jsonMatch = aiText.match(
      /<<<CBT_COMPLETE>>>([\s\S]*?)<<<END_CBT_COMPLETE>>>/,
    );
    if (jsonMatch?.[1]) {
      try {
        cbtData = JSON.parse(jsonMatch[1].trim());
      } catch (err) {
        Logger.log(`JSON Parse Error: ${err}`);
      }
    }
    aiText = aiText
      .replace(/<<<CBT_COMPLETE>>>[\s\S]*?<<<END_CBT_COMPLETE>>>/, "")
      .trim();
  } else {
    history.push({ role: "assistant", content: aiText });
    cache.put(`HISTORY_${chatId}`, JSON.stringify(history), CACHE_TTL_SECONDS);
  }
  return { userMessage: aiText, isComplete, cbtData };
};

const getPureListenerPrompt = (
  dayName,
  dateStr,
  timeStr,
) => `Kamu adalah Xenovia Care, teman pendengar yang sangat hangat, ramah, empatis, dan bijak.
KONTEKS WAKTU SAAT INI (WIB): Hari: ${dayName}, Tanggal: ${dateStr}, Jam Sekarang: ${timeStr}

TUGAS UTAMA:
1. Dengarkan cerita pengguna dengan penuh perhatian, empati, dan kehangatan.
2. DILARANG KERAS menanyakan angka/skala emosi (1-100), pikiran otomatis, atau melakukan analisis psikologi kaku selama pengguna masih bercerita!
3. DILARANG KERAS PAMITAN ATAU MENGELUARKAN KALIMAT PERPISAHAN/PENUTUP OBROLAN!
4. DILARANG KERAS TERUS-TERUSAN MENANYAKAN "Apakah ceritanya sudah tuntas?" ATAU "Apakah ada lagi yang mau disampaikan?" DI SETIAP PESAN!
5. DILARANG KERAS menggunakan kata kaku repetitif seperti "Jadi kamu...", "Berarti...", "Peluk jauh...", atau gaya CS Bank.
6. DILARANG KERAS menggunakan teks narasi/roleplay seperti "*tersenyum*", "[Terdiam]", dsb.
7. ONE QUESTION AT A TIME: DALAM SETIAP BALASAN, AI HANYA BOLEH MENANYAKAN MAKSIMAL 1 PERTANYAAN. Jangan menumpuk beberapa pertanyaan dalam satu balon chat.
8. DOUBLE LINE BREAK: Gunakan newline asli (enter) di antara setiap paragraf/poin — TULISKAN SEBAGAI ENTER/LINE BREAK ASLI, jangan pakai teks literal backslash-n.
9. EMOSI DINAMIS: Jika pengguna menyebut emosi, refleksikan secara presisi sesuai kata mereka (misal: frustrasi, kecewa, lega, bangga). Jangan menggeneralisasi sebagai "cemas" atau "senang" secara otomatis.

PENJAGAAN TRANSISI MODE & SINYAL PENUTUP:
- Selama pengguna masih bercerita, fokuslah merespons isi ceritanya dengan hangat.
- JIKA pengguna memberikan frasa penutup cerita:
  1. DILARANG KERAS PAMITAN ATAU MEMINDAHKAN OBROLAN KE PERPISAHAN!
  2. Langsung berikan apresiasi singkat terhadap keberaniannya bercerita.
  3. Buka pertanyaan bedah CBT pertama secara halus — hanya 1 pertanyaan (tanyakan skala emosi puncak 1-100 saat kejadian).
  4. SELIPKAN TAG RAHASIA <<<TRANSITION_TO_CBT>>> DI PALING AKHIR BALASANMU!`;

const getCbtEvaluatorPrompt = (
  dayName,
  dateStr,
  timeStr,
) => `Kamu adalah Xenovia Care, konselor CBT yang hangat dan bijak. Sekarang pengguna sudah mengonfirmasi bahwa ceritanya tuntas dan siap melakukan refleksi CBT.
KONTEKS WAKTU SAAT INI (WIB): Hari: ${dayName}, Tanggal: ${dateStr}, Jam Sekarang: ${timeStr}

ATURAN UMUM:
- ONE QUESTION AT A TIME: DALAM SETIAP BALASAN, AI HANYA BOLEH MENANYAKAN MAKSIMAL 1 PERTANYAAN. Jangan menumpuk beberapa pertanyaan dalam satu balon chat.
- DOUBLE LINE BREAK: Setiap paragraf, poin, dan field rangkuman WAJIB dipisah newline asli (enter) — TULISKAN SEBAGAI ENTER/LINE BREAK ASLI, jangan pakai teks literal backslash-n.
- EMOSI DINAMIS: Analisis emosi secara presisi berdasarkan cerita pengguna. Jangan pakai asumsi generik.
  * Cerita Positif → identifikasi emosi relevan (bangga, puas, tenang, bersyukur, tertantang, percaya diri, dll).
  * Cerita Negatif → identifikasi emosi aslinya (frustrasi, marah, kecewa, lelah, kesal, overthinking, cemas, dll).
  * Jika menanyakan intensitas/skala emosi, gunakan nama emosi spesifik dari konteks cerita.

ATURAN ALUR EVALUASI CBT (SOCRATIC GATE):
TAHAP 1: SKALA EMOSI PUNCAK
- Tanyakan skala 1-100 untuk emosi spesifik yang sudah teridentifikasi dari cerita. Contoh: "Dari skala 1 sampai 100, seberapa frustrasi yang kamu rasakan saat itu?"
- HANYA 1 PERTANYAAN.

TAHAP 2: BUKTI TANDINGAN (HANYA UNTUK CERITA NEGATIF)
- DILARANG KERAS menyimpulkan, mengarang, atau mengisi 'Bukti Tandingan' secara otomatis/manual.
- Ajukan pertanyaan sokratik bertahap agar pengguna sendiri yang menemukan bukti objektifnya.
- Contoh: "Dari apa yang sebenarnya terjadi, adakah fakta yang menunjukkan bahwa kekhawatiran kamu tidak sepenuhnya terjadi?"

TAHAP 3: PIKIRAN SEIMBANG — ATURAN KETAT BERDASARKAN KATEGORI EMOSI:

  A. CERITA/EMOSI NEGATIF (Kecemasan, Kemarahan, Kesedihan, Stres, atau emosi negatif lainnya):
    • DILARANG KERAS merumuskan atau mengisi "Pikiran Seimbang" sendiri.
    • WAJIB pandu user menulis sendiri: ajukan 1 pertanyaan sokratik seperti "Kata-kata/kalimat apa yang ingin kamu katakan pada dirimu sendiri untuk menyeimbangkan pikiran negatif tadi?"
    • HANYA lanjut ke Rangkuman Akhir setelah user memberikan input Pikiran Seimbang buatan mereka sendiri.

  B. CERITA/EMOSI POSITIF / ADAPTIF (Kategori Utama = Positif):
    • Karena tidak ada distorsi negatif yang perlu disanggah, AI diizinkan merumuskan intisari insight atau prinsip adaptif netral dari cerita pengguna secara otomatis.
    • Dilarang menggunakan penjelasan meta seperti "(Tidak diperlukan)" — langsung tulis intisarinya.

ATURAN FORMAT REPORT:
1. EMOSI & SKALA: NamaEmosi (AngkaSkala) — contoh: "Frustrasi (85)" atau "Bangga (90)"
2. DISTORSI KOGNITIF: Nama Distorsi (Penjelasan Singkat). Untuk kategori Positif: "Tidak Ada (Pikiran Adaptif / Rasional)".
3. KATEGORI UTAMA: Pilih salah satu — "Kecemasan", "Kemarahan", "Positif", "Kesedihan", "Stres"
4. POV NETRAL — DILARANG KERAS kata ganti orang kedua ("kamu", "Anda", "-mu") di seluruh kolom log (Peristiwa, Pikiran Otomatis, Bukti Tandingan, Pikiran Seimbang). Gunakan HANYA kalimat pernyataan netral/objektif atau sudut pandang orang pertama ("Aku" / "Saya").

STANDARDISASI FORMAT RANGKUMAN AKHIR (Double Line Break):
Tampilkan persis dalam format berikut ketika 6 elemen sudah lengkap (sebelum tombol simpan):

RANGKUMAN REFLEKSI CBT

• Peristiwa: <Isi Peristiwa>

• Pikiran Otomatis: "<Isi Pikiran Otomatis>"

• Emosi: <Isi Emosi & Skala>

• Distorsi Kognitif: <Isi Distorsi Kognitif>

• Bukti Tandingan: <Isi Bukti Tandingan>

• Pikiran Seimbang: "<Isi Pikiran Seimbang>"

• Kategori Utama: <Kategori>

• Waktu Kejadian: <Hari, DD/MM/YYYY HH:mm:ss>

Kemudian tanyakan: "Semua catatan CBT kita hari ini udah lengkap dan jernih nih. Mau langsung kita simpan ke Google Sheets sekarang?" dan tempelkan blok JSON ini di paling bawah:
<<<CBT_COMPLETE>>>
{ "peristiwa": "...", "pikiranOtomatis": "...", "emosi": "...", "distorsi": "...", "buktiTandingan": "...", "pikiranSeimbang": "...", "kategori": "...", "waktuKejadian": "..." }
<<<END_CBT_COMPLETE>>>`;

// ====================================================
// SECTION 5: GOOGLE SHEETS & STORAGE SERVICE
// ====================================================
const saveToSheet = (data) => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const sheetName = `${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
  let sheet = ss.getSheetByName(sheetName) ?? ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.setFrozenRows(1);
    sheet.appendRow([
      "Tanggal & Waktu",
      "Peristiwa",
      "Pikiran Otomatis",
      "Emosi & Skala",
      "Distorsi Kognitif",
      "Bukti Tandingan",
      "Pikiran Seimbang",
      "Kategori Utama",
    ]);
    sheet.getRange(1, 1, 1, 8).setFontWeight("bold");
  }
  const { dayName, dateStr, timeStr } = formatTimestampJakarta();
  let timestamp = `${dayName}, ${dateStr} ${timeStr}`;
  if (
    data.waktuKejadian &&
    data.waktuKejadian !== "null" &&
    String(data.waktuKejadian).trim() !== ""
  ) {
    const rawCustom = String(data.waktuKejadian).trim();
    timestamp = rawCustom.includes(",")
      ? rawCustom
      : `${dayName}, ${rawCustom}`;
  }
  let cleanCategory = "Kecemasan";
  for (const cat of VALID_CATEGORIES) {
    if (
      (data.kategori ?? "Kecemasan").toLowerCase().includes(cat.toLowerCase())
    ) {
      cleanCategory = cat;
      break;
    }
  }
  let cleanDistorsion = data.distorsi ?? "-";
  if (cleanCategory === "Positif")
    cleanDistorsion = "Tidak Ada (Pikiran Adaptif / Rasional)";
  sheet.appendRow([
    timestamp,
    data.peristiwa ?? "-",
    data.pikiranOtomatis ?? "-",
    (data.emosi ?? "-").replace(/Skala\s*/gi, "").trim(),
    cleanDistorsion,
    data.buktiTandingan ?? "-",
    data.pikiranSeimbang ?? "-",
    cleanCategory,
  ]);
  sheet.getRange(sheet.getLastRow(), 1, 1, 8).setWrap(true);
};

const getRowsLastNDays = (daysLimit = 30) => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - daysLimit * 24 * 60 * 60 * 1000);
  return ss.getSheets().flatMap((sheet) => {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    return data
      .slice(1)
      .filter((row) => {
        const rowDate = parseDateFromSheet(row[0]);
        return rowDate && rowDate >= cutoffDate && rowDate <= now;
      })
      .map((row) => ({
        tanggal: row[0],
        peristiwa: row[1],
        pikiranOtomatis: row[2],
        emosi: row[3],
        distorsi: row[4],
        buktiTandingan: row[5],
        pikiranSeimbang: row[6],
        kategori: row[7],
      }));
  });
};

const getNegativeRowsLastNDays = (daysLimit = 30) =>
  getRowsLastNDays(daysLimit).filter(
    (r) => (r.kategori ?? "").toLowerCase() !== "positif",
  );

const parseDateFromSheet = (dateStr) => {
  const matchFull = String(dateStr).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return matchFull
    ? new Date(
        Number(matchFull[3]),
        Number(matchFull[2]) - 1,
        Number(matchFull[1]),
      )
    : null;
};

// ====================================================
// SECTION 6: TELEGRAM API SERVICE
// ====================================================
const sendTypingAction = (chatId) => {
  try {
    UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/sendChatAction`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, action: "typing" }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    Logger.log(`sendTypingAction error: ${err}`);
  }
};

const sendTelegramMessage = (chatId, text, replyMarkup = null) => {
  const payload = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const resp = UrlFetchApp.fetch(TELEGRAM_SEND_MESSAGE_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  });
  return JSON.parse(resp.getContentText());
};

const pinTelegramMessage = (chatId, messageId) => {
  UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/pinChatMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    }),
    muteHttpExceptions: true,
  });
};

const unpinAllTelegramMessages = (chatId) => {
  UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/unpinAllChatMessages`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId }),
    muteHttpExceptions: true,
  });
};

const answerCallbackQuery = (callbackQueryId) => {
  UrlFetchApp.fetch(TELEGRAM_ANSWER_CALLBACK_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
};

const getTelegramFileUrl = (fileId) => {
  const response = UrlFetchApp.fetch(
    `${TELEGRAM_BASE_URL}/getFile?file_id=${fileId}`,
    { muteHttpExceptions: true },
  );
  const json = JSON.parse(response.getContentText());
  return json.ok && json.result?.file_path
    ? `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`
    : null;
};

// ====================================================
// SECTION 7: API CALLERS & EXTERNAL SERVICES
// ====================================================
const callDeepSeek = (messages, temp = 0.4) => {
  try {
    const payload = {
      model: OPENROUTER_MODEL,
      messages: messages,
      temperature: temp,
      provider: { order: ["DeepInfra"], allow_fallbacks: true },
    };
    const response = UrlFetchApp.fetch(OPENROUTER_CHAT_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(response.getContentText());
    return (
      json.choices?.[0]?.message?.content ??
      "Maaf, sistem sedang mengalami sedikit gangguan."
    );
  } catch (err) {
    return "Maaf, sistem sedang tidak dapat dijangkau.";
  }
};

const callGemini = (promptText, temp = 0.3) => {
  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: temp },
  };
  const response = UrlFetchApp.fetch(GEMINI_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return (
    JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]
      ?.text ?? ""
  );
};

const transcribeAudioGroq = (fileUrl) => {
  try {
    const audioBlob = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true })
      .getBlob()
      .setName("voice.ogg");
    const response = UrlFetchApp.fetch(GROQ_WHISPER_URL, {
      method: "post",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      payload: {
        file: audioBlob,
        model: "whisper-large-v3-turbo",
        language: "id",
        temperature: "0",
      },
      muteHttpExceptions: true,
    });
    return JSON.parse(response.getContentText()).text ?? "";
  } catch (err) {
    return "";
  }
};

// ====================================================
// SECTION 8: UTILITY & HELPER FUNCTIONS
// ====================================================
const sanitizeQuotes = (text) =>
  text.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();

const sanitizeAIResponse = (text) => {
  if (!text) return text;
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const stripped = trimmed.replace(/^[\s\*]+/, "").toLowerCase();
    // Label CoT — safety layer (DeepSeek pisah reasoning di field terpisah)
    const cotLabels = [
      "user input:",
      "user:",
      "context:",
      "persona:",
      "constraints:",
      "constraints check:",
      "option ",
      "options:",
      "step ",
      "steps:",
      "reasoning:",
      "thought:",
      "thinking:",
      "internal:",
      "note:",
      "notes:",
      "response:",
    ];
    const actionVerbs = [
      "acknowledge",
      "confirm",
      "encourage",
      "ask",
      "provide",
      "offer",
      "suggest",
      "guide",
      "invite",
      "give",
    ];
    const firstWord = stripped.split(/\s+/)[0] ?? "";
    const isInstruction = actionVerbs.some((v) => firstWord.startsWith(v));
    const isConstraintBullet =
      trimmed.startsWith("**") &&
      (stripped.startsWith("no ") ||
        stripped.startsWith("do not") ||
        stripped.startsWith("don't") ||
        stripped.startsWith("tidak ") ||
        stripped.startsWith("jangan ") ||
        stripped.startsWith("gunakan ") ||
        stripped.startsWith("dilarang ") ||
        stripped.startsWith("wajib ") ||
        stripped.startsWith("hanya ") ||
        stripped.match(/^\d+\.\s/));
    if (
      cotLabels.some((p) => stripped.startsWith(p)) ||
      isInstruction ||
      isConstraintBullet
    )
      return false;
    return true;
  });
  let result = filtered.join("\n").trim();
  result = result.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
  result = result.replace(/\\n/g, "\n");
  return result;
};

const formatTimestampJakarta = () => {
  const now = new Date();
  const tz = "Asia/Jakarta";
  return {
    dayName: DAY_NAMES[now.getDay()],
    dateStr: Utilities.formatDate(now, tz, "dd/MM/yyyy"),
    timeStr: Utilities.formatDate(now, tz, "HH:mm:ss"),
  };
};
