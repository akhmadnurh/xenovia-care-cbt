// ====================================================
// cron.js — KEEP WARM & SMART SYNC
// ====================================================

// Time-driven trigger (misal setiap 10 menit). Mencegah cold start
// sekaligus menjalankan Smart Sync Firebase secara periodik.
const keepWarm = () => {
  try {
    CacheService.getScriptCache().put("keep_warm", "active", 300);
    checkAndSyncFirebase();
  } catch (e) {
    Logger.log(`Keep Warm Error: ${e}`);
  }
};

// Sync Sheet → Firebase HANYA jika: belum pernah sync,
// selisih > 12 jam, atau jumlah baris Sheet berubah (edit/hapus manual).
const checkAndSyncFirebase = () => {
  try {
    const props = PropertiesService.getScriptProperties();
    const lastSync = props.getProperty("LAST_FIREBASE_SYNC");
    const lastRowCount = props.getProperty("LAST_ROW_COUNT");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let totalRows = 0;
    ss.getSheets().forEach((sheet) => {
      // Hanya tab jurnal bulanan 2 tahun terakhir — filter sama dgn sync.
      if (isJournalSheet(sheet.getName())) {
        totalRows += sheet.getLastRow();
      }
    });

    const now = Date.now();
    const diff = lastSync ? now - Number.parseInt(lastSync, 10) : Infinity;
    if (
      !lastSync ||
      diff > 12 * 60 * 60 * 1000 ||
      String(totalRows) !== lastRowCount
    ) {
      syncAllSheetToFirebase();
      props.setProperty("LAST_FIREBASE_SYNC", String(now));
      props.setProperty("LAST_ROW_COUNT", String(totalRows));
    }
  } catch (e) {
    Logger.log(`Smart Sync Error: ${e}`);
  }
};
