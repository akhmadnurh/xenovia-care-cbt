// ====================================================
// sheetLogger.js — GOOGLE SHEETS & DATA STORAGE
// ====================================================

// ===== TEMP FLOW LOG (sementara) — hapus blok ini + semua
// pemanggil flowLog()/flushFlowLog() setelah flow diverifikasi =====
// Buffer per execution: semua event dikumpulkan di memori,
// ditulis 1 baris ke tab "APP_LOG" saat request selesai (finally).
const FLOW_LOG_ENABLED = true; // false = cuma muncul di Executions, tidak tulis Sheet
const _flowBuffer = [];

const flowLog = (stage, detail) => {
  const line = `${stage}: ${detail}`;
  Logger.log(`[FLOW] ${line}`);
  if (FLOW_LOG_ENABLED) _flowBuffer.push(line);
};

const flushFlowLog = (chatId = "-") => {
  if (!FLOW_LOG_ENABLED || !_flowBuffer.length) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName("APP_LOG");
    if (!sh) {
      sh = ss.insertSheet("APP_LOG");
      sh.appendRow(["Waktu", "Chat ID", "Flow"]);
      sh.getRange(1, 1, 1, 3).setFontWeight("bold");
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 160);
      sh.setColumnWidth(2, 100);
      sh.setColumnWidth(3, 600);
    }
    sh.appendRow([new Date(), String(chatId), _flowBuffer.join("  →  ")]);
  } catch (err) {
    Logger.log(`flushFlowLog error: ${err}`);
  }
  _flowBuffer.length = 0;
};
// ===== END TEMP FLOW LOG =====

const saveToSheet = (data) => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const sheetName = `${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
  let sheet = ss.getSheetByName(sheetName) ?? ss.insertSheet(sheetName);

  // Ensure column widths are always correct (idempotent, runs on every save)
  const COL_WIDTHS = [180, 280, 250, 180, 220, 280, 320, 140];
  COL_WIDTHS.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

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

// Row shape helper — normalisasi dari array Sheet atau object Firebase
const toRowObject = (row) => ({
  tanggal: row.tanggal ?? row[0] ?? "",
  peristiwa: row.peristiwa ?? row[1] ?? "",
  pikiranOtomatis: row.pikiranOtomatis ?? row[2] ?? "",
  emosi: row.emosi ?? row[3] ?? "",
  distorsi: row.distorsi ?? row[4] ?? "",
  buktiTandingan: row.buktiTandingan ?? row[5] ?? "",
  pikiranSeimbang: row.pikiranSeimbang ?? row[6] ?? "",
  kategori: row.kategori ?? row[7] ?? "",
});

// Primary: Firebase. Fallback: Google Sheet (bila Firebase belum dikonfigurasi).
const getRowsLastNDays = (daysLimit = 30) => {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - daysLimit * 24 * 60 * 60 * 1000);

  const fbRows = getLatestRowsFromFirebase(1000);
  if (fbRows.length > 0) {
    return fbRows
      .filter((row) => {
        const rowDate = row.timestamp_ms
          ? new Date(row.timestamp_ms)
          : parseDateFromSheet(row.tanggal);
        return rowDate && rowDate >= cutoffDate && rowDate <= now;
      })
      .map(toRowObject);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().flatMap((sheet) => {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    return data
      .slice(1)
      .filter((row) => {
        const rowDate = parseDateFromSheet(row[0]);
        return rowDate && rowDate >= cutoffDate && rowDate <= now;
      })
      .map(toRowObject);
  });
};

const getNegativeRowsLastNDays = (daysLimit = 30) =>
  getRowsLastNDays(daysLimit).filter(
    (r) => (r.kategori ?? "").toLowerCase() !== "positif",
  );

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

  // Primary: Firebase. Fallback: Google Sheet (bila Firebase belum dikonfigurasi).
  let matchedRows = searchFirebase(query);
  if (matchedRows.length === 0) {
    const keywords = query.toLowerCase().split(/\s+/);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    matchedRows = ss.getSheets().flatMap((sheet) => {
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return [];
      return data
        .slice(1)
        .filter((row) => {
          const rowDate = parseDateFromSheet(row[0]);
          if (!rowDate || rowDate < cutoffDate) return false;
          return keywords.every((kw) =>
            row.join(" ").toLowerCase().includes(kw),
          );
        })
        .map(toRowObject);
    });
  }

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

const getRandomWinRecord = () => {
  const positiveRows = getRowsLastNDays(30).filter(
    (r) => (r.kategori ?? "").toLowerCase() === "positif",
  );
  if (positiveRows.length === 0) return null;
  return positiveRows[Math.floor(Math.random() * positiveRows.length)];
};

const getEmotionStats = (days) => {
  const rows = getRowsLastNDays(days);
  if (rows.length === 0)
    return {
      total: 0,
      dominantEmotion: "-",
      dominantPercentage: 0,
      emotionFrequencies: [],
      averageScale: 0,
    };
  const emotionCount = {};
  let totalScale = 0;
  let scaleCount = 0;
  rows.forEach((r) => {
    const raw = (r.emosi ?? "").toString();
    const parts = raw.split(",");
    parts.forEach((part) => {
      const cleaned = part
        .replace(/\s*\(.*?\)/g, "")
        .replace(/\s+menurun.*/i, "")
        .trim();
      if (cleaned) {
        emotionCount[cleaned] = (emotionCount[cleaned] ?? 0) + 1;
      }
    });
    const scaleMatch = raw.match(/\((\d+)\)/);
    if (scaleMatch) {
      totalScale += parseInt(scaleMatch[1]);
      scaleCount++;
    }
  });
  const total = Object.values(emotionCount).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(emotionCount)
    .map(([emotion, count]) => ({
      emotion,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
  return {
    total,
    dominantEmotion: sorted[0]?.emotion ?? "-",
    dominantPercentage: sorted[0]?.percentage ?? 0,
    emotionFrequencies: sorted,
    averageScale: scaleCount > 0 ? Math.round(totalScale / scaleCount) : 0,
  };
};

// Retroactive fix: set column widths on existing sheets that were created before auto-width was added
const applyColumnWidthsToAllSheets = () => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const COL_WIDTHS = [180, 280, 250, 180, 220, 280, 320, 140];
  ss.getSheets().forEach((sheet) => {
    if (sheet.getLastRow() > 0) {
      COL_WIDTHS.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
    }
  });
};
