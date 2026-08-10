// ====================================================
// memoryHandler.js — LONG-TERM MEMORY (2 BULAN)
// Gemini Flash Lite = Notulis; DeepSeek = Konselor CBT
// ====================================================

const MEMORY_EXTRACTION_PROMPT = (
  transcriptText,
) => `Kamu adalah sistem ekstraksi data untuk aplikasi Xenovia Care CBT Journal.
Tugas utama: Menganalisis transkrip percakapan sesi CBT antara User dan Asisten AI, lalu merangkumnya menjadi entri memori jangka panjang yang padat, presisi, dan faktual.

INSTRUKSI KETAT:
1. HANYA ekstrak informasi yang benar-benar disebutkan di dalam transkrip. Dilarang keras mengarang, mendiagnosis hal baru, atau menambahkan asumsi yang tidak tertulis.
2. Fokus pada respons psikologis, pola kognitif, dan sensasi fisik/somatik user jika ada.
3. Output HARUS dalam format JSON valid tanpa teks tambahan di luar blok JSON.

STRUKTUR OUTPUT JSON:
{
  "summary_version": 1,
  "core_insights": {
    "trigger_and_context": "Pemicu utama atau situasi yang diceritakan user",
    "automatic_thoughts": "Pikiran otomatis atau overthinking yang muncul",
    "somatic_sensations": "Sensasi fisik/somatik yang dirasakan (misal: rasa berat, cemas, kantuk mendadak, dsb. Isikan '-' jika tidak ada)",
    "cbt_distortions": ["Daftar jenis distorsi kognitif yang teridentifikasi"],
    "effective_reframing": "Sudut pandang baru/rasional atau logika reframing yang berhasil disepakati",
    "actionable_anchor": "Teknik grounding, coping mechanism, atau mindset yang dipakai"
  },
  "raw_summary_narrative": "Ringkasan 2-3 kalimat mengenai dinamika emosi dan perkembangan kognitif user pada sesi ini."
}

TRANSKRIP PERCAKAPAN:
${transcriptText}`;

// Blok konteks memori yang disisipkan ke system prompt DeepSeek
const buildMemoryContextBlock = (
  memoryData,
) => `Kamu adalah Xenovia Care, asisten dan teman pendamping CBT (Cognitive Behavioral Therapy) yang empatik, terstruktur, dan rasional.
Tugasmu adalah menyimak percakapan user, membantu mengidentifikasi distorsi pikiran, serta memandu proses reframing dan grounding secara alami.

--- KONTEKS MEMORI HISTORIS USER (2 BULAN TERAKHIR) ---
Abaikan jika kosong. Gunakan data historis di bawah ini sebagai pemahaman latar belakang tanpa perlu meminta user menjelaskan ulang hal-hal yang sudah terdaftar di sini:

${memoryData}

ATURAN PENGGUNAAN MEMORI:
1. Konteks di atas adalah FAKTA HISTORIS perjalanan mental dan fisik user. Jangan pernah mengarang kejadian, kondisi fisik, atau riwayat baru di luar data tersebut.
2. Gunakan memori secara alami untuk memberikan empati yang berkesinambungan (contoh: memahami jika user mengalami pola atau sensasi fisik yang mirip dengan sesi sebelumnya), tanpa terkesan kaku seperti membaca laporan medis.
3. Tetap fokus pada apa yang disampaikan user di sesi berjalan saat ini.

Gaya Komunikasi: Empatik, suportif, grounded, direct, dan tidak menggurui.`;

// Notulis: ekstrak sesi CBT jadi JSON terstruktur lalu simpan ke cbt_memories
const generateAndSaveCbtMemory = (chatId, sessionTranscript) => {
  try {
    if (!sessionTranscript?.length) return;
    const aiText = callGemini(
      MEMORY_EXTRACTION_PROMPT(JSON.stringify(sessionTranscript)),
      0.1,
      { maxOutputTokens: 1024 },
    );
    const memoryObj = parseMemoryJson(aiText);
    if (!memoryObj) return;
    memoryObj.id = `mem_${Date.now()}`;
    memoryObj.timestamp = new Date().toISOString();
    saveCbtMemory(chatId, memoryObj);
  } catch (e) {
    Logger.log(`generateAndSaveCbtMemory error: ${e}`);
  }
};

// Parse JSON dari Gemini — tahan markdown code fence & JSON malformed
const parseMemoryJson = (aiText) => {
  if (!aiText) return null;
  try {
    const cleaned = aiText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "");
    const parsed = JSON.parse(cleaned);
    if (!parsed.core_insights || typeof parsed.core_insights !== "object") {
      return null;
    }
    return parsed;
  } catch (e) {
    Logger.log(`Memory JSON parse error: ${e}`);
    return null;
  }
};

// Format memori 60 hari terakhir jadi bullet points untuk system prompt DeepSeek
const getTwoMonthMemoryFormatted = (chatId) => {
  try {
    const memories = getCbtMemoriesLast60Days(chatId);
    if (!memories.length) return "(Belum ada riwayat sesi CBT yang tersimpan.)";
    return memories
      .map((m) => {
        const ci = m.core_insights || {};
        const date = (m.timestamp || "").slice(0, 10);
        const distortions = Array.isArray(ci.cbt_distortions)
          ? ci.cbt_distortions.join(", ")
          : "-";
        return `- [${date}] Context: ${ci.trigger_and_context ?? "-"} | Somatik: ${ci.somatic_sensations ?? "-"} | Distorsi: ${distortions} | Reframing: ${ci.effective_reframing ?? "-"}`;
      })
      .join("\n");
  } catch (e) {
    Logger.log(`getTwoMonthMemoryFormatted error: ${e}`);
    return "(Belum ada riwayat sesi CBT yang tersimpan.)";
  }
};

// Backfill one-time dari /jurnal — jalankan manual dari Apps Script editor
const backfillCbtMemoriesFromJurnal = (chatId) => {
  if (!chatId) {
    Logger.log("backfillCbtMemoriesFromJurnal: chatId wajib diisi");
    return;
  }
  const rows = getLatestRowsFromFirebase(1000);
  if (!rows.length) {
    Logger.log("backfillCbtMemoriesFromJurnal: tidak ada data jurnal");
    return;
  }
  let saved = 0;
  rows.forEach((row, i) => {
    const pseudoTranscript = [
      {
        role: "user",
        content: `Peristiwa: ${row.peristiwa ?? "-"}\nPikiran otomatis: ${row.pikiranOtomatis ?? "-"}\nEmosi: ${row.emosi ?? "-"}`,
      },
      {
        role: "assistant",
        content: `Distorsi kognitif: ${row.distorsi ?? "-"}\nBukti tandingan: ${row.buktiTandingan ?? "-"}\nPikiran seimbang: ${row.pikiranSeimbang ?? "-"}\nKategori: ${row.kategori ?? "-"}`,
      },
    ];
    const aiText = callGemini(
      MEMORY_EXTRACTION_PROMPT(JSON.stringify(pseudoTranscript)),
      0.1,
      { maxOutputTokens: 1024 },
    );
    const memoryObj = parseMemoryJson(aiText);
    if (memoryObj) {
      memoryObj.id = `mem_${Date.now()}_${i}`;
      memoryObj.timestamp = new Date(
        row.timestamp_ms || Date.now(),
      ).toISOString();
      saveCbtMemory(chatId, memoryObj);
      saved++;
    }
    if (i < rows.length - 1) Utilities.sleep(500);
  });
  Logger.log(
    `backfillCbtMemoriesFromJurnal: ${saved}/${rows.length} entry tersimpan`,
  );
};
