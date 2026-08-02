// ====================================================
// sheetLogger.js — GOOGLE SHEETS & DATA STORAGE
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
