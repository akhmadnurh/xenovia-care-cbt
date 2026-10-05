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

// HTTP OpenAI-compatible (dipakai OpenCode Go & OpenRouter chat)
const callOpenAICompat = (
  { url, apiKey, model, extraHeaders = {} },
  messages,
  temp,
  maxRetries = 3,
) => {
  const payload = { model: model, messages: messages, temperature: temp };
  const response = fetchWithRetry(
    url,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      payload: JSON.stringify(payload),
    },
    maxRetries,
  );
  const json = JSON.parse(response.getContentText());
  if (!json.choices?.[0]?.message?.content) throw new Error("empty choices");
  return json.choices[0].message.content;
};

// Engine utama — tier 1: OpenCode Go (mimo-v2.6-flash), tier 2: OpenRouter (mimo-v2.6-flash)
// ponytail: tanpa circuit breaker; kalau Go sering down dan tiap pesan bayar 1 attempt gagal,
// tambah flag "skip Go 5 menit" di CacheService.
const callMainAI = (messages, temp = 0.4, sessionId = "") => {
  if (CONFIG.OPENCODE_API_KEY) {
    try {
      const out = callOpenAICompat(
        {
          url: OPENCODE_URL,
          apiKey: CONFIG.OPENCODE_API_KEY,
          model: OPENCODE_MODEL,
          extraHeaders: {
            "User-Agent": "xenovia-care-cbt/1.0",
            "x-opencode-session": String(sessionId || "xenovia"),
          },
        },
        messages,
        temp,
        1, // fail-fast — begitu gagal, langsung jatuh ke tier 2
      );
      flowLog("ai", `tier=GO (${OPENCODE_MODEL}) ✓ len=${out.length}`);
      return out;
    } catch (err) {
      Logger.log(`callMainAI: OpenCode Go gagal → fallback OpenRouter: ${err}`);
      flowLog("ai", `tier=GO gagal → fallback: ${err?.message ?? err}`);
    }
  } else {
    flowLog("ai", "tanpa OPENCODE_API_KEY → langsung OpenRouter");
  }
  try {
    const out = callOpenAICompat(
      {
        url: OPENROUTER_CHAT_URL,
        apiKey: CONFIG.OPENROUTER_API_KEY,
        model: OPENROUTER_MODEL,
      },
      messages,
      temp,
    );
    flowLog("ai", `tier=OpenRouter (${OPENROUTER_MODEL}) ✓ len=${out.length}`);
    return out;
  } catch (err) {
    Logger.log(`callMainAI: OpenRouter gagal: ${err}`);
    flowLog("ai", `tier=OpenRouter GAGAL: ${err?.message ?? err}`);
    return err?.message === "empty choices"
      ? FALLBACK_AI_ERROR
      : FALLBACK_AI_UNREACHABLE;
  }
};

// --- Jev (OpenRouter Decisions API) — klasifikasi terpadu ---
// Balasannya numerik (probabilitas), bukan teks — code langsung branch.
const callJev = (state, questions) => {
  try {
    const response = fetchWithRetry(OPENROUTER_JEV_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}` },
      payload: JSON.stringify({ model: JEV_MODEL, state, questions }),
    });
    const answers = JSON.parse(response.getContentText()).answers ?? null;
    flowLog(
      "jev",
      answers ? `OK (${Object.keys(answers).length} q)` : "answers kosong",
    );
    return answers;
  } catch (err) {
    Logger.log(`callJev error: ${err}`);
    flowLog("jev", `GAGAL: ${err?.message ?? err} → jalur legacy`);
    return null; // null → caller pakai jalur legacy
  }
};

// ponytail: threshold masih provisional — kalibrasi dari Logger.log "JEV gate" setelah 1-2 minggu data nyata
const JEV_THRESHOLD = { crisis: 0.7, save: 0.75, mode: 0.6 };

// Satu callJev per pesan bebas (bukan slash command) — semua pertanyaan paralel dalam 1 request.
// return null saat Jev gagal → caller fallback ke perilaku lama.
const runMessageGate = (chatId, userMessage, currentMode, hasPendingCbt) => {
  let historyTail = "";
  try {
    const h = JSON.parse(
      CacheService.getUserCache().get(`HISTORY_${chatId}`) ?? "[]",
    );
    historyTail = h
      .slice(-10)
      .map((m) => `${m.role}: ${String(m.content).slice(0, 300)}`)
      .join("\n");
  } catch (e) {
    /* tanpa riwayat tetap jalan */
  }

  const questions = {
    is_crisis: {
      type: "noul",
      instructions:
        "Apakah pesan ini mengandung niat menyakiti diri sendiri, bunuh diri, atau bahaya akut yang butuh respons darurat?",
      criteria: {
        true: "Pengguna menyatakan ingin mati/hilang, menyakiti diri sendiri, atau berada dalam bahaya fisik akut.",
        false:
          "Sedih, kelelahan, kecemasan, keluhan umum, atau cerita sehari-hari tanpa niat menyakiti diri.",
      },
    },
    mode: {
      type: "choice",
      instructions:
        "Berdasarkan pesan dan riwayat, percakapan harus berlanjut ke mana?",
      criteria: {
        story:
          "Pengguna sedang menceritakan pengalaman/kejadian dan belum memberi tanda selesai.",
        cbt: "Pengguna memberi frasa penutup cerita ATAU sedang menjawab langkah evaluasi CBT (skala emosi, pikiran otomatis, distorsi, bukti tandingan).",
        done: "Pengguna menutup sesi atau merespons konfirmasi simpan.",
      },
    },
    needs_past_recall: {
      type: "noul",
      instructions:
        "Apakah pesan merujuk ke kejadian/pengalaman lampau yang pernah diceritakan sebelumnya dan mungkin tercatat di jurnal?",
      criteria: {
        true: "Pengguna menyebut kejadian lama atau frasa seperti 'yang kemarin', 'waktu itu', 'kayak dulu', 'yang pernah aku ceritakan'.",
        false: "Cerita kejadian baru atau merespons langkah CBT berjalan.",
      },
    },
  };
  if (hasPendingCbt) {
    questions.save_confirm = {
      type: "noul",
      instructions:
        "Apakah pesan ini konfirmasi untuk menyimpan catatan CBT yang baru saja ditawarkan?",
      criteria: {
        true: "Jawaban setuju/positif menyimpan: iya, ya, simpan, oke, ok, gas, mantap, bener, save.",
        false:
          "Cerita baru, pertanyaan, jawaban yang tidak menyetujui, atau topik lain.",
      },
    };
  }

  const answers = callJev(
    {
      chat_id: String(chatId),
      current_mode: currentMode,
      has_pending_cbt: hasPendingCbt,
      recent_history: historyTail,
      message: userMessage,
    },
    questions,
  );
  if (!answers) return null;

  const gate = {
    crisis: answers.is_crisis?.noul ?? 0,
    mode: answers.mode?.choice ?? null,
    modeConfidence: answers.mode?.confidence ?? 0,
    recall: answers.needs_past_recall?.noul ?? 0,
    save: answers.save_confirm?.noul ?? 0,
  };
  flowLog("gate", JSON.stringify(gate));
  Logger.log(`JEV gate chat=${chatId}: ${JSON.stringify(gate)}`);
  return gate;
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
    // Label CoT — safety layer (beberapa model menaruh reasoning berlabel di content)
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

// Smoke test — jalankan manual dari Apps Script editor, lihat hasil di Logs.
// Cek: (1) engine menjawab tanpa masalah, (2) Jev gate pulang dengan probabilitas.
function testPipeline() {
  const ai = callMainAI(
    [{ role: "user", content: "Halo, aku lagi sedih banget hari ini." }],
    0.4,
    "test",
  );
  Logger.log(`[1] callMainAI → ${String(ai).slice(0, 200)}`);

  const normal = runMessageGate(
    "test",
    "udah itu aja sih ceritaku",
    "PURE_LISTENING",
    false,
  );
  Logger.log(`[2] gate normal → ${JSON.stringify(normal)}`);

  const save = runMessageGate("test", "iya simpan aja", "CBT_EVALUATOR", true);
  Logger.log(`[3] gate save → ${JSON.stringify(save)}`);

  const crisis = runMessageGate(
    "test",
    "aku pengen hilang aja dari dunia ini",
    "PURE_LISTENING",
    false,
  );
  Logger.log(`[4] gate crisis → ${JSON.stringify(crisis)}`);

  flushFlowLog("test"); // tulis buffer ke tab APP_LOG
}
