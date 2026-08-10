// ====================================================
// webApp.js — WEB APP BRIDGE LAYER
// Single entry point: processWebMessage(input)
// Returns typed JSON payloads for index.html rendering.
// ====================================================

const WEB_CHAT_ID = "WEB_APP_USER";

/**
 * Main bridge — routes any user input and returns JSON payload.
 * @param {string} input - Raw user input text (commands or free text)
 * @returns {{ type: string, [key: string]: any }}
 */
function processWebMessage(input) {
  const raw = (input || "").trim();
  const lower = raw.toLowerCase();

  try {
    // --- Fixed commands ---
    if (lower === "/breathing") return _webBreathing();
    if (lower === "/grounding") return _webStartGrounding();
    if (lower === "/win") return _webWin();
    if (lower === "/reframe") return _webReframeTopics();
    if (lower.startsWith("/reframe_content")) return _webReframeContent(raw);
    if (lower === "/anchor") return _webAnchor();
    if (lower === "/stats") return _webStats(7);
    if (lower === "/stats30") return _webStats(30);
    if (lower.startsWith("/rekap")) return _webRekap(raw);
    if (lower.startsWith("/cari"))
      return { type: "text", text: handleCari(raw) };
    if (lower === "/help" || lower === "/start")
      return { type: "text", text: getHelpText() };

    // --- Grounding in progress? ---
    const props = PropertiesService.getUserProperties();
    const groundingState = props.getProperty(`GROUNDING_STATE_${WEB_CHAT_ID}`);
    if (groundingState) {
      const reply = processGroundingStep(WEB_CHAT_ID, raw, groundingState);
      return { type: "text", text: reply };
    }

    // --- CBT save confirm ---
    const cache = CacheService.getUserCache();
    const pendingCbt = cache.get(`PENDING_CBT_${WEB_CHAT_ID}`);
    if (
      pendingCbt &&
      /^(iya|ya|iy|y|iyaa|simpan|save|yes|oke|ok)\b/i.test(lower)
    ) {
      const cbtData = JSON.parse(pendingCbt);
      saveToSheet(cbtData);
      saveToFirebase(cbtData);
      cache.remove(`PENDING_CBT_${WEB_CHAT_ID}`);
      cache.remove(`HISTORY_${WEB_CHAT_ID}`);
      cache.remove(`MODE_${WEB_CHAT_ID}`);
      return { type: "text", text: "✅ Data CBT berhasil disimpan!" };
    }

    // --- Free text → CBT engine ---
    return _webProcessCBT(raw);
  } catch (err) {
    Logger.log(`processWebMessage error: ${err}`);
    return { type: "text", text: "⚠️ Terjadi kesalahan, silakan coba lagi." };
  }
}

// ──────────────────────────────────────────────
// Private web helpers (inline logic, no Telegram side-effects)
// ──────────────────────────────────────────────

function _webBreathing() {
  return {
    type: "gif",
    gifUrl: CONFIG.GIF_BREATHING_URL,
    caption: BREATHING_CAPTION,
  };
}

function _webStartGrounding() {
  const props = PropertiesService.getUserProperties();
  props.setProperty(`GROUNDING_STATE_${WEB_CHAT_ID}`, "STEP_5_SEE");
  props.setProperty(`GROUNDING_ITEMS_${WEB_CHAT_ID}`, "[]");

  const text = `🌿 *Teknik Grounding 5-4-3-2-1*

Teknik ini membantu menenangkan sistem sarafmu dengan menghubungkan kembali pikiran ke lingkungan sekitar melalui panca indera.

Mari kita mulai!

*${GROUNDING_LABELS.STEP_5_SEE.label}*

Sebutkan 5 benda yang kamu lihat di sekitarmu saat ini.
✨ Setiap benda WAJIB disertai deskripsi visualnya ya.
Contoh: *"Daun mangga berwarna hijau tua"*, *"Bantal sofa berwarna krem"*, *"Lampu kamar berbentuk bulat"*`;

  return { type: "text", text };
}

function _webWin() {
  const record = getRandomWinRecord();
  if (!record)
    return {
      type: "text",
      text: "ℹ️ Belum ada catatan positif dalam 30 hari terakhir.",
    };
  const narrative = generateWinNarrative(record);
  return { type: "text", text: narrative || formatWinFallback(record) };
}

function _webReframeTopics() {
  const negRows = getNegativeRowsLastNDays(30);
  if (negRows.length === 0)
    return {
      type: "text",
      text: "ℹ️ Belum ada catatan CBT emosi negatif dalam 30 hari terakhir.",
    };

  const sampleText = negRows
    .slice(-25)
    .map((r) => r.peristiwa)
    .filter(Boolean)
    .join("\n");

  const promptTopics = `Analisis daftar peristiwa berikut dari pengguna:\n${sampleText}\n\nEkstrak dan kelompokkan menjadi 4-5 TOPIC SPECIFIC RINGKAS (Maksimal 2-3 kata per topik).\nWAJIB beri 1 Emoji relevan di depan setiap topik.\nDILARANG menggunakan nama emosi umum seperti 'Kecemasan' atau 'Stres'.\n\nKembalikan HANYA JSON Array valid tanpa markdown:\n[{"id":"t1","label":"🤢 Sensasi Lambung","keywords":["lambung"]}]`;

  let topics = [];
  const aiTopicRes = callGemini(promptTopics, 0.1, { maxOutputTokens: 150 });
  if (aiTopicRes) {
    try {
      const cleaned = aiTopicRes
        .replace(/```(?:json)?\s*/gi, "")
        .replace(/```\s*/g, "");
      const jsonMatch = cleaned.match(/\[[\s\S]*?\]/);
      if (jsonMatch?.[0]) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0)
          topics = parsed.map((t) => ({
            id: t.id,
            label: t.label,
            keywords: t.keywords ?? (t.keyword ? [t.keyword] : []),
          }));
      }
    } catch (e) {
      Logger.log(`Web reframe topic parse error: ${e}`);
    }
  }

  // Fallback: keyword-based topic abstraction
  if (topics.length === 0) {
    const TOPIC_MAP = [
      {
        keywords: ["makan", "lambung", "mual", "perut", "asam", "makanan"],
        label: "🤢 Sensasi Lambung",
      },
      {
        keywords: ["kerja", "tugas", "kantor", "deadline", "pekerjaan"],
        label: "💼 Pekerjaan & Tugas",
      },
      {
        keywords: ["fisik", "jantung", "nafas", "pusing", "sakit", "dada"],
        label: "🫀 Sensasi Fisik",
      },
      {
        keywords: ["pikiran", "overthinking", "khawatir", "membayang"],
        label: "🧠 Overthinking",
      },
      {
        keywords: ["tidur", "bangun", "pagi", "malam", "insomnia"],
        label: "🌅 Kecemasan Pagi",
      },
      {
        keywords: ["sosial", "orang", "bicara", "kerumunan", "teman"],
        label: "👥 Interaksi Sosial",
      },
    ];
    const allText = negRows
      .map((r) => `${r.peristiwa} ${r.pikiranOtomatis}`.toLowerCase())
      .join(" ");
    topics = TOPIC_MAP.map((t) => ({
      ...t,
      hits: t.keywords.filter((kw) => allText.includes(kw)).length,
    }))
      .filter((t) => t.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5)
      .map((t, i) => ({
        id: `topic_${i + 1}`,
        label: t.label,
        keywords: t.keywords,
      }));

    if (topics.length === 0) {
      const EMOJIS = ["🔹", "🔸", "🟣", "🟤", "⚪"];
      const freq = {};
      negRows.forEach((r) => {
        const p = (r.peristiwa ?? "").trim();
        if (!p) return;
        const key = p.length > 25 ? p.slice(0, 25) + "…" : p;
        freq[key] = (freq[key] || 0) + 1;
      });
      topics = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label], i) => ({
          id: `topic_${i + 1}`,
          label: `${EMOJIS[i]} ${label}`,
          keywords: [],
        }));
    }
  }

  // Cache topics for reframe content lookup
  const cache = CacheService.getUserCache();
  cache.put(`TOPICS_${WEB_CHAT_ID}`, JSON.stringify(topics), CACHE_TTL_SECONDS);

  return { type: "topics", topics };
}

function _webReframeContent(raw) {
  // Extract topicId from "/reframe_content t1" or "/reframe_content topic_1"
  const parts = raw.split(/\s+/);
  const topicId = (parts[1] || "").replace(/^rf:/, "");
  if (!topicId) return { type: "text", text: "⚠️ Topik tidak valid." };

  const cache = CacheService.getUserCache();
  const topicsCache = JSON.parse(cache.get(`TOPICS_${WEB_CHAT_ID}`) || "[]");

  const negRows = getNegativeRowsLastNDays(30);
  if (negRows.length === 0)
    return { type: "text", text: "ℹ️ Belum ada catatan reframing tersedia." };

  let selectedRows = [];
  const idx = Number.parseInt(topicId.replace(/\D/g, ""), 10);
  const topicObj = topicsCache[idx];
  const topicLabel = topicObj ? topicObj.label : "Topik";
  const keywords = topicObj?.keywords || [];
  if (keywords.length > 0) {
    selectedRows = negRows.filter((r) => {
      const text = `${r.peristiwa} ${r.pikiranOtomatis}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }
  if (selectedRows.length === 0) {
    selectedRows = [...negRows].sort(() => 0.5 - Math.random()).slice(0, 3);
  } else {
    selectedRows = selectedRows.slice(-3);
  }

  const rowsContext = selectedRows
    .map(
      (r, i) =>
        `${i + 1}. Tanggal: ${r.tanggal}\n   Peristiwa: ${r.peristiwa}\n   Pikiran Otomatis: ${r.pikiranOtomatis}\n   Emosi: ${r.emosi}\n   Bukti Tandingan: ${r.buktiTandingan}\n   Pikiran Seimbang: ${r.pikiranSeimbang}`,
    )
    .join("\n\n");

  const promptP3K = `Kamu adalah Xenovia Care. Buatkan pesan P3K Reframing berdasarkan data riwayat pengguna dari Google Sheet berikut:\n${rowsContext}\n\nATURAN FORMATTING KETAT:\n1. WAJIB TAMPILKAN SEKSI REFRAME TERPISAH: Tampilkan 1-3 Pikiran Seimbang asli milik pengguna dari sheet dalam daftar terpisah.\n2. Setiap poin Pikiran Seimbang WAJIB berada di BARIS BARU (newline) menggunakan numbering 1. "...", 2. "...". DILARANG menyatukannya ke dalam paragraf narasi!\n3. DILARANG menggunakan italic/cetak miring (* atau _).\n4. DILARANG menggunakan garis pemisah (---) atau label kaku seperti 'SEKSI 1'.\n\nSTRUKTUR RESPOIN WAJIB:\n\nHalo, aku Xenovia Care. [1 Paragraf Validasi Emosi]\n\n[1 Paragraf Grounding & Olah Napas]\n\n💡 **Pegangan Utama dari Pikiran Seimbangmu:**\n1. "[Pikiran Seimbang 1 dari sheet]"\n2. "[Pikiran Seimbang 2 dari sheet]"\n3. "[Pikiran Seimbang 3 dari sheet jika ada]"\n\n[1-2 Paragraf Rekam Jejak Bukti Nyata dari Sheet]\n\n🚀 **3 Langkah Kecil Detik Ini:**\n- [Langkah 1]\n- [Langkah 2]\n- [Langkah 3]\n\n[1 Paragraf Afirmasi Penutup Suportif ala /win]`;

  const aiRes = callGemini(promptP3K, 0.3, { maxOutputTokens: 600 });
  let responseText;
  if (aiRes && aiRes.trim() !== "") {
    responseText = sanitizeQuotes(aiRes);
  } else {
    responseText = `🌿 **P3K Reframing — ${topicLabel}**\n\nIngat: sensasi yang kamu rasakan saat ini sudah pernah terjadi sebelumnya dan selalu mereda. Kamu sudah membuktikannya 🤍`;
  }
  return { type: "text", text: responseText.trim() };
}

function _webAnchor() {
  const negRows = getNegativeRowsLastNDays(30);
  const journalContext =
    negRows.length > 0
      ? negRows
          .map(
            (r) =>
              `- Tanggal: ${r.tanggal} | Peristiwa: ${r.peristiwa} | Pikiran: ${r.pikiranOtomatis} | Emosi: ${r.emosi} | Bukti Tandingan: ${r.buktiTandingan} | Pikiran Seimbang: ${r.pikiranSeimbang}`,
          )
          .join("\n")
      : "(Belum ada catatan jurnal dalam 30 hari terakhir)";

  const promptAnchor = `Kamu adalah Xenovia Care — pendamping CBT yang hangat, tenang, dan grounded. Tugasmu menghasilkan pesan selamat pagi + 1 kalimat afirmasi "Pegangan Utama Hari Ini" (anchor).

KONTEKS JURNAL PENGGUNA (30 HARI TERAKHIR):
${journalContext}

Gunakan data jurnal di atas HANYA untuk memahami kebutuhan emosional pengguna. JANGAN mengutip ulang gejala atau peristiwa spesifik dari jurnal.

TONE OF VOICE (STRICT):
- DILARANG bahasa gaul extreme / lebay: 'bosku', 'lu', 'nongkrong', 'gas pol', 'urusan dunia', 'bestie', 'gengs', 'cuy', 'beb', dll.
- DILARANG bahasa retoris / bertele-tele.
- DILARANG bahasa puitis / mendayu-dayu.
- DILARANG cringey: "kesayangan", "peluk jauh", "dekap".
- DILARANG tanda baca em-dash atau dua strip (--)!
- Gunakan bahasa Indonesia kasual yang natural, tenang, sopan, ramah, dan grounded.

SALAM PAGI (WAJIB):
- Maksimal 1-2 kalimat pendek, ringkas, hangat, tanpa basa-basi panjang.

PEGANGAN UTAMA / ANCHOR (WAJIB):
- Maksimal 1 kalimat padat, di bawah 15 kata.
- DILARANG TANDA PETIK di dalam anchor.
- PILIH SALAH SATU dari 5 sudut pandang berikut secara ACAK:
  1. Penerimaan Hari  2. Batas Diri  3. Kontrol Diri  4. Kehadiran Saat Ini  5. Self-Compassion

STRUKTUR OUTPUT (HANYA DUA BARIS):
SALAM: [1-2 kalimat salam pagi]
ANCHOR: [1 kalimat anchor singkat tanpa tanda petik]`;

  const aiRes = callGemini(promptAnchor, 0.4);
  let anchorText;
  if (aiRes && aiRes.trim() !== "") {
    const lines = aiRes
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let salam = DEFAULT_MORNING_GREETING;
    let anchor = DEFAULT_ANCHOR_SENTENCE;
    lines.forEach((line) => {
      const upper = line.toUpperCase();
      if (upper.startsWith("SALAM:")) salam = line.substring(6).trim();
      else if (upper.startsWith("ANCHOR:")) anchor = line.substring(7).trim();
    });
    const cleanAnchor = anchor.replace(/^"+|"+$/g, "");
    anchorText = `🌅 **Selamat Pagi!**\n${salam}\n\n💡 **Pegangan Utama Hari Ini:**\n"${cleanAnchor}"`;
  } else {
    anchorText = `🌅 **Selamat Pagi!**\n${DEFAULT_MORNING_GREETING}\n\n💡 **Pegangan Utama Hari Ini:**\n"${DEFAULT_ANCHOR_SENTENCE}"`;
  }
  return { type: "text", text: anchorText };
}

function _webStats(days) {
  const stats = getEmotionStats(days);
  const freqText = stats.emotionFrequencies
    .map((e) => `${e.emotion}: ${e.count}x (${e.percentage}%)`)
    .join(", ");
  const statsSummary = `Periode: ${days} hari | Total sesi: ${stats.total} | Emosi dominan: ${stats.dominantEmotion} (${stats.dominantPercentage}%) | Rata-rata skala: ${stats.averageScale} | Frekuensi: ${freqText}`;
  const aiInsight = callGeminiForStats(statsSummary, days);
  return {
    type: "text",
    text: formatStatsMessage(stats, days, aiInsight),
  };
}

function _webRekap(raw) {
  const lower = raw.toLowerCase();
  let type = "minggu";
  if (lower.includes("bulan")) type = "bulan";
  return { type: "text", text: handleRekap(`/rekap ${type}`) };
}

function _webProcessCBT(userMessage) {
  const cache = CacheService.getUserCache();
  let history = JSON.parse(cache.get(`HISTORY_${WEB_CHAT_ID}`) ?? "[]");
  let currentMode = cache.get(`MODE_${WEB_CHAT_ID}`) ?? "PURE_LISTENING";
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
    cache.put(`MODE_${WEB_CHAT_ID}`, "CBT_EVALUATOR", CACHE_TTL_SECONDS);
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
        Logger.log(`Web CBT JSON Parse Error: ${err}`);
      }
    }
    aiText = aiText
      .replace(/<<<CBT_COMPLETE>>>[\s\S]*?<<<END_CBT_COMPLETE>>>/, "")
      .trim();
  } else {
    history.push({ role: "assistant", content: aiText });
    cache.put(
      `HISTORY_${WEB_CHAT_ID}`,
      JSON.stringify(history),
      CACHE_TTL_SECONDS,
    );
  }

  if (isComplete && cbtData) {
    // Store pending save — frontend will show confirm button
    cache.put(
      `PENDING_CBT_${WEB_CHAT_ID}`,
      JSON.stringify(cbtData),
      CACHE_TTL_SECONDS,
    );
    return { type: "cbt_complete", text: aiText, cbtData };
  }
  return { type: "text", text: aiText };
}
