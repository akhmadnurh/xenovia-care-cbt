// ====================================================
// firebaseService.js — FIREBASE REALTIME DB (CACHE LAYER)
// ====================================================

const getFirebaseConfig = () => {
  const props = PropertiesService.getScriptProperties();
  return {
    url: props.getProperty("FIREBASE_URL"),
    secret: props.getProperty("FIREBASE_SECRET"),
  };
};

const firebaseAvailable = () => {
  const { url, secret } = getFirebaseConfig();
  return Boolean(url && secret);
};

// POST 1 row CBT baru — dipanggil paralel dengan saveToSheet()
const saveToFirebase = (cbtData) => {
  if (!firebaseAvailable()) return;
  try {
    const { url, secret } = getFirebaseConfig();
    let timestamp =
      formatTimestampJakarta().dateStr + " " + formatTimestampJakarta().timeStr;
    if (
      cbtData.waktuKejadian &&
      cbtData.waktuKejadian !== "null" &&
      String(cbtData.waktuKejadian).trim() !== ""
    ) {
      const rawCustom = String(cbtData.waktuKejadian).trim();
      timestamp = rawCustom;
    }
    let cleanCategory = "Kecemasan";
    for (const cat of VALID_CATEGORIES) {
      if (
        (cbtData.kategori ?? "Kecemasan")
          .toLowerCase()
          .includes(cat.toLowerCase())
      ) {
        cleanCategory = cat;
        break;
      }
    }
    let cleanDistorsion = cbtData.distorsi ?? "-";
    if (cleanCategory === "Positif")
      cleanDistorsion = "Tidak Ada (Pikiran Adaptif / Rasional)";

    const payload = {
      tanggal: timestamp,
      peristiwa: cbtData.peristiwa ?? "-",
      pikiranOtomatis: cbtData.pikiranOtomatis ?? "-",
      emosi: (cbtData.emosi ?? "-").replace(/Skala\s*/gi, "").trim(),
      distorsi: cleanDistorsion,
      buktiTandingan: cbtData.buktiTandingan ?? "-",
      pikiranSeimbang: cbtData.pikiranSeimbang ?? "-",
      kategori: cleanCategory,
      timestamp_ms: Date.now(),
    };

    UrlFetchApp.fetch(`${url}/jurnal.json?auth=${secret}`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log(`Firebase Save Error: ${e}`);
  }
};

// Sheet dianggap tab jurnal bulanan jika: namanya mengandung bulan Indonesia,
// bukan tab Widget_/non-jurnal, dan tahun pada nama tab masih dalam
// 2 tahun berjalan (termasuk tahun ini). Tab lama tetap aman di Sheet sbg arsip.
const isJournalSheet = (sheetName, now = new Date()) => {
  if (sheetName.startsWith("Widget_")) return false;
  if (!MONTHS_ID.some((m) => sheetName.includes(m))) return false;
  const yearMatch = sheetName.match(/\d{4}/);
  if (!yearMatch) return false;
  return Number.parseInt(yearMatch[0], 10) >= now.getFullYear() - 2;
};

// PUT replace seluruh isi DB dengan data dari semua tab Sheet bulanan
// (hanya tab 2 tahun terakhir — 24 bulan dari tahun berjalan).
const syncAllSheetToFirebase = () => {
  if (!firebaseAvailable()) return;
  try {
    const { url, secret } = getFirebaseConfig();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const payload = {};

    ss.getSheets().forEach((sheet) => {
      if (!isJournalSheet(sheet.getName())) return;

      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;
      data.slice(1).forEach((row, index) => {
        const rowDate = parseDateFromSheet(row[0]);
        const ts = rowDate ? rowDate.getTime() : Date.now();
        const key = `entry_${ts}_${index}`;
        payload[key] = {
          tanggal: row[0],
          peristiwa: row[1],
          pikiranOtomatis: row[2],
          emosi: row[3],
          distorsi: row[4],
          buktiTandingan: row[5],
          pikiranSeimbang: row[6],
          kategori: row[7],
          timestamp_ms: ts,
        };
      });
    });

    UrlFetchApp.fetch(`${url}/jurnal.json?auth=${secret}`, {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log(`Firebase Sync Error: ${e}`);
  }
};

// GET N baris terbaru — source utama operasi read
const getLatestRowsFromFirebase = (limit = 30) => {
  if (!firebaseAvailable()) return [];
  try {
    const { url, secret } = getFirebaseConfig();
    const endpoint = `${url}/jurnal.json?orderBy="$key"&limitToLast=${limit}&auth=${secret}`;
    const res = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (!data || typeof data !== "object") return [];
      return Object.values(data)
        .filter((r) => r && typeof r === "object")
        .sort((a, b) => (b.timestamp_ms || 0) - (a.timestamp_ms || 0));
    }
  } catch (e) {
    Logger.log(`Firebase Get Error: ${e}`);
  }
  return [];
};

// GET seluruh data lalu filter kata kunci pada peristiwa & pikiran
const searchFirebase = (query) => {
  if (!firebaseAvailable()) return [];
  try {
    const { url, secret } = getFirebaseConfig();
    const endpoint = `${url}/jurnal.json?auth=${secret}`;
    const res = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (!data || typeof data !== "object") return [];
      const keywords = query.toLowerCase().split(/\s+/);
      return Object.values(data)
        .filter((r) => {
          if (!r || typeof r !== "object") return false;
          const text =
            `${r.peristiwa ?? ""} ${r.pikiranOtomatis ?? ""}`.toLowerCase();
          return keywords.every((kw) => text.includes(kw));
        })
        .sort((a, b) => (b.timestamp_ms || 0) - (a.timestamp_ms || 0));
    }
  } catch (e) {
    Logger.log(`Firebase Search Error: ${e}`);
  }
  return [];
};
