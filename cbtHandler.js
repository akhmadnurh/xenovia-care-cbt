// ====================================================
// cbtHandler.js — CBT JOURNALING, REFRAMING & ANCHOR
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
2. FASE BERCERITA = FASE MENYIMAK. SELAMA pengguna masih bercerita, DILARANG KERAS menanyakan angka/skala emosi, pikiran otomatis, distorsi kognitif, atau melakukan analisis psikologi kaku. Cukup berikan respon validasi yang hangat dan dengarkan.
3. DILARANG KERAS PAMITAN ATAU MENGELUARKAN KALIMAT PERPISAHAN/PENUTUP OBROLAN!
4. DILARANG KERAS MENANYAKAN "Apakah ceritanya sudah tuntas?" ATAU "Apakah ada lagi yang mau disampaikan?" — JANGAN PERNAH bertanya tentang kelengkapan cerita. Biarkan pengguna sendiri yang menandai selesai.
5. DILARANG KERAS menggunakan kata kaku repetitif seperti "Jadi kamu...", "Berarti...", "Peluk jauh...", atau gaya CS Bank.
6. DILARANG KERAS menggunakan teks narasi/roleplay seperti "*tersenyum*", "[Terdiam]", dsb.
7. ONE QUESTION AT A TIME: DALAM SETIAP BALASAN, AI HANYA BOLEH MENANYAKAN MAKSIMAL 1 PERTANYAAN. Jangan menumpuk beberapa pertanyaan dalam satu balon chat.
8. DOUBLE LINE BREAK: Gunakan newline asli (enter) di antara setiap paragraf/poin — TULISKAN SEBAGAI ENTER/LINE BREAK ASLI, jangan pakai teks literal backslash-n.
9. EMOSI DINAMIS: Jika pengguna menyebut emosi, refleksikan secara presisi sesuai kata mereka (misal: frustrasi, kecewa, lega, bangga). Jangan menggeneralisasi sebagai "cemas" atau "senang" secara otomatis.
10. EXTRACT DATA DARI CHAT: Saat pengguna bercerita, mereka mungkin sudah menyebutkan emosi dan skala secara natural (misal: "gelisah banget, kayak 70-an", "marahnya 85"). Catat/mengerti data ini dari konteks cerita — JANGAN tanya ulang nanti di sesi CBT.

TRANSISI OTOMATIS KE SESI CBT:
JIKA pengguna memberikan frasa penutup cerita — termasuk tetapi tidak terbatas pada:
"udah itu aja", "itu aja sih", "ceritaku cuma itu", "segitu aja", "ya udah", "udah deh", "cuma itu", "selesai", "habis itu ya", atau frasa penutup sejenis lainnya —
MAKA:
  1. DILARANG KERAS PAMITAN ATAU MEMINDAHKAN OBROLAN KE PERPISAHAN!
  2. Berikan apresiasi singkat dan tulus terhadap keberaniannya bercerita (1-2 kalimat).
  3. TRANSISI langsung ke sesi CBT — langsung ajukan langkah pertama (tanya skala emosi puncak 1-100 ATAU kalau sudah disebut di cerita, langsung konfirmasi dan lanjut ke pikiran otomatis). HANYA 1 PERTANYAAN.
  4. SELIPKAN TAG RAHASIA <<<TRANSITION_TO_CBT>>> DI PALING AKHIR BALASANMU!
  5. PERINGATAN: Frasa penutup cerita BUKAN sinyal untuk mengakhiri chat. Ini adalah sinyal untuk TRANSISI ke sesi refleksi CBT.`;

const getCbtEvaluatorPrompt = (
  dayName,
  dateStr,
  timeStr,
) => `Kamu adalah Xenovia Care, konselor CBT yang hangat dan bijak. Pengguna sudah selesai bercerita dan siap melakukan refleksi CBT.
KONTEKS WAKTU SAAT INI (WIB): Hari: ${dayName}, Tanggal: ${dateStr}, Jam Sekarang: ${timeStr}

ATURAN UMUM & INTERAKSI:
- SENSOR SELESAI CERITA: Jika pengguna masih bercerita, berikan tanggapan yang validatif dan hangat. Jika pengguna memberikan penanda cerita selesai (misal: "udah itu aja", "itu aja sih", "ceritaku cuma itu"), LANGSUNG OTOMATIS masuk ke Alur Evaluasi CBT di bawah tanpa perlu bertanya konfirmasi.
- ONE QUESTION AT A TIME: DALAM SETIAP BALASAN, AI HANYA BOLEH MENANYAKAN MAKSIMAL 1 PERTANYAAN. Dilarang menumpuk pertanyaan dalam satu balon chat.
- DOUBLE LINE BREAK: Setiap paragraf, poin, dan field rangkuman WAJIB dipisah newline asli (enter).
- EMOSI DINAMIS: Analisis emosi secara presisi berdasarkan cerita pengguna. Jangan gunakan asumsi generik.

DETEKSI DATA EKSISTING (STRICT):
Sebelum mengajukan pertanyaan apapun, PERIKSA riwayat percakapan sebelumnya dengan seksama:
- Jika data (Nama Emosi, Skala Angka 1-100, atau Pikiran Otomatis) SUDAH DISEBUTKAN pengguna secara natural saat bercerita → SIMPAN data tersebut dan DILARANG MENANYAKAN ULANG!
- Tanyakan HANYA variabel CBT yang BELUM ADA di dalam percakapan.

ALUR EVALUASI CBT (STRICT SEQUENCE):
Jalankan urutan ini secara runtut. Skip langkah yang datanya sudah lengkap dari percakapan:

STEP 1: KUMPULKAN DATA AWAL YANG BELUM LENGKAP
- Emosi & Skala Puncak (1-100): Tanyakan HANYA jika belum disebut user di cerita awal.
- Pikiran Otomatis / Kekhawatiran Utama: Tanyakan apa pikiran/kekhawatiran utama yang muncul saat kejadian (HANYA 1 PERTANYAAN).

STEP 2: IDENTIFIKASI DISTORSI KOGNITIF
- Identifikasi distorsi kognitif yang relevan dari cerita user (misal: catastrophizing, mind reading, black-and-white thinking, dll).
- Jelaskan singkat & empatis mengapa hal tersebut merupakan distorsi dalam konteks ceritanya.

STEP 3: BUKTI TANDINGAN & PIKIRAN SEIMBANG (REFRAMING)
A. UNTUK EMOSI NEGATIF (Kecemasan, Kemarahan, Kesedihan, Stres, dll):
   • Bukti Tandingan: DILARANG KERAS merumuskan/mengisi sendiri. Ajukan 1 pertanyaan sokratik agar pengguna menemukan buktinya secara mandiri.
   • Pikiran Seimbang: DILARANG KERAS merumuskan sendiri. Pandu pengguna menuliskan kalimat penyeimbang untuk dirinya sendiri.
   • EVALUASI KUALITAS PIKIRAN SEIMBANG: Setelah pengguna menulis Pikiran Seimbang, CEK kualitasnya:
     - Jika mengandung TOXIC POSITIVITY (melarang diri merasa emosi negatif, memaksa selalu positif, kalimat klise tanpa berpatokan pada Bukti Tandingan yang sudah dibahas):
       → Validasi emosi pengguna dengan hangat — ingatkan bahwa emosi negatif itu wajar dan manusiawi.
       → Tawarkan alternatif kalimat yang menghubungkan penerimaan emosi + Bukti Tandingan objektif yang sudah ditemukan tadi.
       → Ajukan 1 pertanyaan lembut: apakah mereka ingin menggunakan kalimat alternatif tersebut.
     - Jika SUDAH SEIMBANG & REALISTIS (berpatokan pada bukti, menerima emosi tanpa memaksakan):
       → Apresiasi singkat dan LANGSUNG tampilkan RANGKUMAN REFLEKSI CBT.

B. UNTUK EMOSI POSITIF / ADAPTIF:
   • Karena tidak ada distorsi negatif yang perlu disanggah, AI diizinkan merumuskan intisari insight atau prinsip adaptif netral dari cerita pengguna secara otomatis.

ATURAN FORMAT LOG & REPORT:
1. EMOSI & SKALA: Format murni skala awal tanpa skala akhir — contoh: "Gelisah (30)" atau "Kecemasan (70)"
2. DISTORSI KOGNITIF: Nama Distorsi (Penjelasan Singkat). Untuk kategori Positif: "Tidak Ada (Pikiran Adaptif / Rasional)"
3. KATEGORI UTAMA: Pilih salah satu — "Kecemasan", "Kemarahan", "Positif", "Kesedihan", "Stres"
4. POV NETRAL DI LOG: DILARANG KERAS menggunakan kata ganti orang kedua ("kamu", "Anda", "-mu") di seluruh kolom log (Peristiwa, Pikiran Otomatis, Bukti Tandingan, Pikiran Seimbang). Gunakan HANYA kalimat pernyataan netral/objektif atau sudut pandang orang pertama ("Aku" / "Saya").

STANDARDISASI RANGKUMAN AKHIR:
Tampilkan persis dalam format berikut ketika 6 elemen sudah lengkap (sebelum menyimpan ke database):

RANGKUMAN REFLEKSI CBT

• Peristiwa: <Isi Peristiwa>

• Pikiran Otomatis: "<Isi Pikiran Otomatis>"

• Emosi: <Isi Emosi & Skala — Contoh: Gelisah (30)>

• Distorsi Kognitif: <Isi Distorsi Kognitif>

• Bukti Tandingan: <Isi Bukti Tandingan>

• Pikiran Seimbang: "<Isi Pikiran Seimbang>"

• Kategori Utama: <Kategori>

• Waktu Kejadian: <Gunakan format: Hari, DD/MM/YYYY HH:mm:ss dari variabel sistem>

Kemudian tanyakan: "Semua catatan CBT kita hari ini udah lengkap dan jernih nih. Mau langsung kita simpan ke Google Sheets sekarang?" dan tempelkan blok JSON ini di paling bawah:
<<<CBT_COMPLETE>>>
{ "peristiwa": "...", "pikiranOtomatis": "...", "emosi": "...", "distorsi": "...", "buktiTandingan": "...", "pikiranSeimbang": "...", "kategori": "...", "waktuKejadian": "..." }
<<<END_CBT_COMPLETE>>>`;

// --- Morning Anchor (/anchor) ---

const executeAnchorFlow = (chatId) => {
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
- DILARANG bahasa retoris / bertele-tele: format tanya-jawab seperti "Capek mikirin skenario buruk? Mending...".
- DILARANG bahasa puitis / mendayu-dayu: "merangkul kelembutan", "memeluk diri", "proses pemulihan yang indah".
- DILARANG cringey: "kesayangan", "peluk jauh", "dekap".
- DILARANG tanda baca em-dash atau dua strip (--)!
- Gunakan bahasa Indonesia kasual yang natural, tenang, sopan, ramah, dan grounded — layaknya teman pendamping yang dewasa.

SALAM PAGI (WAJIB):
- Maksimal 1-2 kalimat pendek, ringkas, hangat, tanpa basa-basi panjang.
- Varian konteks: kadang tanya kabar, kadang pengingat minum air, kadang sekadar nyapa singkat.

PEGANGAN UTAMA / ANCHOR (WAJIB):
- Maksimal 1 kalimat padat, di bawah 15 kata.
- DILARANG bertele-tele atau membuat analogi panjang.
- DILARANG TANDA PETIK di dalam anchor (Sistem JS yang akan menambahkannya).
- DILARANG selalu memakai frasa "di depan mata" secara terus-menerus.
- PILIH SALAH SATU dari 5 sudut pandang berikut secara ACAK tiap dipanggil. Karang kalimat fresh sendiri (JANGAN copy-paste contoh):
  1. Penerimaan Hari: hari ini gak harus berjalan mulus untuk tetap bisa dinikmati.
  2. Batas Diri: gak perlu menyelesaikan segalanya, cukup seperlunya.
  3. Kontrol Diri: sensasi bisa naik turun, tapi kendali respons tetap ada di tanganku.
  4. Kehadiran Saat Ini: aku aman di detik ini, hal yang belum terjadi gak perlu dipikirkan.
  5. Self-Compassion: pelan-pelan saja, istirahat sejenak bukan tanda menyerah.
- ROTASIKAN ke-5 sudut pandang di atas secara SEIMBANG — jangan terpaku pada satu tema saja.

STRUKTUR OUTPUT (HANYA DUA BARIS, TANPA TEKS TAMBAHAN):
SALAM: [1-2 kalimat salam pagi yang segar & variatif]
ANCHOR: [1 kalimat anchor singkat tanpa tanda petik]`;

  // Build anchor message with hard‑enforced quotes and SALAM/ANCHOR parsing
  const aiRes = callGemini(promptAnchor, 0.4);
  let anchorText;
  if (aiRes && aiRes.trim() !== "") {
    // Expected two lines: SALAM: ... and ANCHOR: ...
    const lines = aiRes
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let salam = DEFAULT_MORNING_GREETING;
    let anchor = DEFAULT_ANCHOR_SENTENCE;
    lines.forEach((line) => {
      const upper = line.toUpperCase();
      if (upper.startsWith("SALAM:")) {
        salam = line.substring(6).trim();
      } else if (upper.startsWith("ANCHOR:")) {
        anchor = line.substring(7).trim();
      }
    });
    // Remove any stray quotes from anchor then wrap with required quotes
    const cleanAnchor = anchor.replace(/^"+|"+$/g, "");
    anchorText = `🌅 **Selamat Pagi!**\n${salam}\n\n💡 **Pegangan Utama Hari Ini:**\n"${cleanAnchor}"`;
  } else {
    // Fallback to defaults, ensuring quotes are present
    anchorText = `🌅 **Selamat Pagi!**\n${DEFAULT_MORNING_GREETING}\n\n💡 **Pegangan Utama Hari Ini:**\n"${DEFAULT_ANCHOR_SENTENCE}"`;
  }

  const widgetSs = SpreadsheetApp.getActiveSpreadsheet();
  let widgetSheet =
    widgetSs.getSheetByName("Widget_Anchor") ??
    widgetSs.insertSheet("Widget_Anchor");
  const distilledLine = anchorText.includes("Pegangan Utama Hari Ini:")
    ? (anchorText.split("Pegangan Utama Hari Ini:")[1] ?? "")
        .replace(/\*\*/g, "")
        .replace(/[""]/g, "")
        .trim()
    : anchorText.replace(/\*\*/g, "").replace(/[""]/g, "").trim();
  widgetSheet.getRange("A1").setValue(distilledLine);
  const { dateStr, timeStr } = formatTimestampJakarta();
  widgetSheet.getRange("B1").setValue(`Last Update: ${dateStr} ${timeStr}`);

  unpinAllTelegramMessages(chatId);
  const sentRes = sendTelegramMessage(chatId, anchorText);
  if (sentRes?.ok && sentRes?.result?.message_id)
    pinTelegramMessage(chatId, sentRes.result.message_id);
};

// --- Reframing Instan (/reframe) ---

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

const generateWinNarrative = (record) => {
  const prompt = `Kamu adalah Xenovia Care, asisten psikologi CBT yang hangat dan manusiawi. Berikut adalah catatan positif dari jurnal CBT pengguna di masa lalu:

- Tanggal: ${record.tanggal}
- Peristiwa: ${record.peristiwa}
- Pikiran Otomatis: ${record.pikiranOtomatis}
- Emosi & Skala: ${record.emosi}
- Distorsi Kognitif: ${record.distorsi}
- Bukti Tandingan: ${record.buktiTandingan}
- Pikiran Seimbang: ${record.pikiranSeimbang}

TUGAS:
Ceritakan kembali kemenangan kecil pengguna ini sebagai narasi yang hangat, personal, dan membumi.

ATURAN TONE (STRICT):
- HARAM menggunakan kalimat toxic positivity atau motivasi kosong: "Semangat ya!", "Pasti bisa!", "Jangan cemas!", "Harus positif!", "Everything will be fine!".
- Gunakan nada bicara seperti teman dekat yang mengingatkan pengguna akan keberhasilannya sendiri — hangat, jujur, tanpa menggurui.
- GAYA CHAT MURNI: Tulis seperti mengirim pesan WhatsApp/Telegram kepada teman. Narasi harus mengalir natural sebagai paragraf cerita utuh yang menyatu. JANGAN gunakan emoji penanda di awal paragraf (🚫🌿, 📜, 💡, ⚓ di awal baris).
- ATURAN EMOJI DINAMIS (FULL CONTEXTUAL FREEDOM): Kamu bebas memilih dan menggunakan EMOJI APA PUN dari pustaka emoji yang menurutmu paling pas, relevan, dan bernyawa sesuai dengan konteks cerita/catatan yang sedang di-recall. Jangan terbatas pada emoji tertentu. Sesuaikan emoji secara organik dengan nuansa emosi, peristiwa, atau objek spesifik yang ada di catatan (misal: aktivitas fisik, hiburan, suasana alam, rasa lega, keberhasilan, dll). Selipkan 2-4 emoji tersebut secara alami di tengah atau akhir kalimat agar terasa seperti pesan chat yang personal, tulus, dan ramah.

STRUKTUR (Wajib ikuti urutan paragraf ini — tanpa emoji penanda di awal):
Paragraf 1 — Validasi:
Validasi bahwa lelah/cemas yang dirasakan pengguna SEKARANG adalah respon yang wajar, bukan kemunduran. Contoh pembuka: "Halo. Jika hari ini kamu merasa lelah, berat, atau kecemasan itu kembali mendekat..."

Paragraf 2-3 — Cerita Masa Lalu:
Narasi pengingat data masa lalu tersebut — ceritakan peristiwa, sensasi, pikiran, dan emosi yang pengguna alami saat itu. Detail spesifik dan natural, JANGAN berupa daftar/bullet. Gunakan sudut pandang kedua ("Ingatkah kamu pada [Tanggal]? Saat itu, kamu...").

Paragraf 4 — Penguat Penutup:
Penguat logis bahwa pengguna SEKARANG masih memegang kendali yang sama seperti saat itu. Bukan soal "bisa", tapi soal "sudah terbukti pernah". Contoh penutup: "Hari ini, kamu tidak perlu memikirkan apakah kamu 'bisa' atau tidak. Ingatlah bahwa kamu sudah terbukti pernah melakukannya 🤍."

FORMAT:
- Murni gaya chat — paragraf mengalir tanpa emoji penanda di awal baris.
- Selipkan 2-4 emoji kontekstual secara natural di tengah/akhir kalimat — bebas memilih emoji apa pun yang paling pas dan bernyawa sesuai konteks cerita.
- Gunakan Markdown bold secara pas untuk penekanan — jangan terlalu sering.
- Tanpa bullet list.
- Gunakan newline asli antar paragraf.
- Tanpa pembats visual (---) — biarkan narasi mengalir.
- 150-250 kata.`;
  return callGemini(prompt, 0.5);
};

const formatWinFallback = (record) => {
  return `🏆 *SATU BUKTI KEMENANGAN NYATA*

Jika hari ini kamu merasa lelah atau berat, ingatlah satu hal ini...

Pada ${record.tanggal}, kamu berhasil melalui: ${record.peristiwa}. Saat itu, kamu menulis pikiran seimbang: _${record.pikiranSeimbang}_. Emosi yang kamu kelola saat itu: ${record.emosi}. Kamu tidak menepis rasa takut, melainkan menghadapinya secara perlahan 😊.

Hari ini, kamu tidak perlu membuktikan apa-apa. Kamu sudah terbukti pernah melakukannya 🤍.`;
};

const formatStatsMessage = (stats, days, aiInsight) => {
  if (stats.total === 0) {
    return `ℹ️ Belum ada data CBT dalam *${days} hari terakhir* di Google Sheets.`;
  }
  let msg = `📊 *Statistik Emosi CBT — ${days} Hari Terakhir*\n\n`;
  msg += `📈 *Ringkasan Data*\n`;
  msg += `• Total sesi: *${stats.total}*\n`;
  msg += `• Emosi dominan: *${stats.dominantEmotion}* (${stats.dominantPercentage}%)\n`;
  msg += `• Rata-rata skala emosi: *${stats.averageScale}*\n\n`;
  msg += `📋 *Frekuensi Emosi*\n`;
  stats.emotionFrequencies.forEach((e) => {
    msg += `• *${e.emotion}*: ${e.count}x (${e.percentage}%)\n`;
  });
  msg += `\n🧠 *Clinical & Emotional Insight*\n${aiInsight}`;
  return msg;
};
