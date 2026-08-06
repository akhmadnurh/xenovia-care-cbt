// ====================================================
// services.js — TELEGRAM & EXTERNAL API CLIENTS
// ====================================================

// --- Resilience: Universal fetch wrapper with retry ---

const fetchWithRetry = (url, options = {}, maxRetries = 3, delayMs = 1000) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = UrlFetchApp.fetch(url, {
        ...options,
        muteHttpExceptions: true,
      });
      const code = resp.getResponseCode();
      if (code === 429 || (code >= 500 && code < 600)) {
        lastError = new Error(`HTTP ${code} from ${url}`);
        if (attempt < maxRetries) {
          Utilities.sleep(delayMs * attempt);
          continue;
        }
      }
      return resp;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        Utilities.sleep(delayMs * attempt);
        continue;
      }
    }
  }
  throw new Error(
    `fetchWithRetry failed after ${maxRetries} attempts: ${lastError}`,
  );
};

// --- Telegram API ---

const sendTypingAction = (chatId) => {
  try {
    fetchWithRetry(`${TELEGRAM_BASE_URL}/sendChatAction`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (err) {
    Logger.log(`sendTypingAction error: ${err}`);
  }
};

const sendTelegramMessage = (chatId, text, replyMarkup = null) => {
  try {
    const payload = { chat_id: chatId, text, parse_mode: "Markdown" };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const resp = fetchWithRetry(TELEGRAM_SEND_MESSAGE_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
    });
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log(`sendTelegramMessage error: ${err}`);
    return { ok: false };
  }
};

const sendTelegramAnimation = (chatId, animationUrl, caption) => {
  try {
    const payload = {
      chat_id: chatId,
      animation: animationUrl,
      caption,
      parse_mode: "Markdown",
    };
    const resp = fetchWithRetry(`${TELEGRAM_BASE_URL}/sendAnimation`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
    });
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log(`sendTelegramAnimation error: ${err}`);
    return { ok: false };
  }
};

const answerCallbackQuery = (callbackQueryId, text = "") => {
  try {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    fetchWithRetry(TELEGRAM_ANSWER_CALLBACK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
    });
  } catch (err) {
    Logger.log(`answerCallbackQuery error: ${err}`);
  }
};

const pinTelegramMessage = (chatId, messageId) => {
  try {
    fetchWithRetry(`${TELEGRAM_BASE_URL}/pinChatMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        disable_notification: true,
      }),
    });
  } catch (err) {
    Logger.log(`pinTelegramMessage error: ${err}`);
  }
};

const unpinAllTelegramMessages = (chatId) => {
  try {
    fetchWithRetry(`${TELEGRAM_BASE_URL}/unpinAllChatMessages`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId }),
    });
  } catch (err) {
    Logger.log(`unpinAllTelegramMessages error: ${err}`);
  }
};

const getTelegramFileUrl = (fileId) => {
  try {
    const response = fetchWithRetry(
      `${TELEGRAM_BASE_URL}/getFile?file_id=${fileId}`,
    );
    const json = JSON.parse(response.getContentText());
    return json.ok && json.result?.file_path
      ? `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${json.result.file_path}`
      : null;
  } catch (err) {
    Logger.log(`getTelegramFileUrl error: ${err}`);
    return null;
  }
};

// --- External AI API Clients ---

const callDeepSeek = (messages, temp = 0.4) => {
  try {
    const payload = {
      model: OPENROUTER_MODEL,
      messages: messages,
      temperature: temp,
      provider: { order: ["DeepInfra"], allow_fallbacks: true },
    };
    const response = fetchWithRetry(OPENROUTER_CHAT_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}` },
      payload: JSON.stringify(payload),
    });
    const json = JSON.parse(response.getContentText());
    return json.choices?.[0]?.message?.content ?? FALLBACK_DEEPSEEK_ERROR;
  } catch (err) {
    return FALLBACK_DEEPSEEK_UNREACHABLE;
  }
};

const callGemini = (promptText, temp = 0.3, opts = {}) => {
  try {
    const payload = {
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: { temperature: temp, ...opts },
    };
    const response = fetchWithRetry(GEMINI_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
    });
    return (
      JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]
        ?.text ?? ""
    );
  } catch (err) {
    Logger.log(`callGemini error: ${err}`);
    return "";
  }
};

const callGeminiForStats = (statsSummary, days) => {
  const prompt = `Kamu adalah Xenovia Care, asisten psikologi CBT yang hangat, ringan, dan suportif — layaknya teman ngobrol yang paham CBT. Berikut data statistik emosi pengguna (${days} hari terakhir):

${statsSummary}

ATURAN TONE (STRICT):
- DILARANG toxic positivity atau motivasi kosong ("Semangat ya!", "Jangan cemas!", "Harus positif!").
- DILARANG menggunakan istilah medis/klinis yang menakutkan: "hyperarousal", "korteks prefrontal menurun", "kerusakan neurobiologis", "kortisol berlebihan", "penurunan efisiensi", atau istilah teknis serupa. Gunakan bahasa sederhana yang bisa dipahami siapa saja.
- Tone of voice: membumi, hangat, ringan, dan suportif. Seperti teman yang mengingatkan kamu tentang hal-hal baik dari data jurnalmu.

STRUKTUR (3-4 paragraf yang kaya isi, detail, dan mendalam):
- Paragraf 1 (Validasi & Reframing): Normalisasi emosi yang muncul tanpa menghakimi. Jelaskan mengapa emosi-emosi tersebut wajar muncul dalam aktivitas sehari-hari, dan bagaimana tubuh serta pikiran merespons tekanan dengan caranya sendiri. Contoh: "Melihat data minggu ini, wajar kalau tubuh dan pikiran terasa agak lelah..."
- Paragraf 2 (Edukasi & Analisis Pola): Edukasi regulasi emosi dengan bahasa yang sangat sederhana — misalnya menjelaskan bagaimana pola emosi yang terjadi berkaitan dengan aktivitas harian, kualitas tidur, atau interaksi sosial. Analisis pola dari data: apakah ada emosi yang mendominasi, apakah skala intensitasnya stabil atau naik-turun, dan apa artinya secara praktis.
- Paragraf 3 (Apresiasi & Penghargaan): Apresiasi setiap emosi tenang/senang, keberhasilan mencatat jurnal, atau konsistensi pengguna dalam meluangkan waktu untuk diri sendiri. Tekankan bahwa konsistensi ini adalah bentuk perhatian yang nyata.
- Paragraf 4 (Saran Langkah Aplikatif): Berikan 2-3 langkah praktis yang sangat aplikatif dan spesifik — misal: teknik napas 4-4 (tarik napas 4 hitungan, tahan 4 hitungan, buang 4 hitungan), jeda layar 5 menit setiap 45 menit kerja, peregangan ringan di bangku kerja, atau menulis 3 hal kecil yang syukuri sebelum tidur. Gunakan emoji sebagai pembuka paragraf.

FORMAT:
- Minimal 300 kata, maksimal 500 kata.
- Gunakan emoji sebagai judul paragraf.
- Gunakan Markdown bold untuk penekanan pada poin-poin penting.
- Gunakan newline asli antar paragraf.`;
  return callGemini(prompt, 0.3);
};

const transcribeAudioGroq = (fileUrl) => {
  try {
    const audioBlob = fetchWithRetry(fileUrl).getBlob().setName("voice.ogg");
    const response = fetchWithRetry(GROQ_WHISPER_URL, {
      method: "post",
      headers: { Authorization: `Bearer ${CONFIG.GROQ_API_KEY}` },
      payload: {
        file: audioBlob,
        model: "whisper-large-v3-turbo",
        language: "id",
        temperature: "0",
      },
    });
    return JSON.parse(response.getContentText()).text ?? "";
  } catch (err) {
    return "";
  }
};

// ====================================================
// UTILITY & HELPER FUNCTIONS
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
