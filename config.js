// ====================================================
// config.js — CONFIGURATION & STATIC CONSTANTS
// ====================================================

const SCRIPT_PROP = PropertiesService.getScriptProperties();

const CONFIG = {
  TELEGRAM_TOKEN: SCRIPT_PROP.getProperty("TELEGRAM_TOKEN"),
  OPENROUTER_API_KEY: SCRIPT_PROP.getProperty("OPENROUTER_API_KEY"),
  GEMINI_API_KEY: SCRIPT_PROP.getProperty("GEMINI_API_KEY"),
  GROQ_API_KEY: SCRIPT_PROP.getProperty("GROQ_API_KEY"),
  SPREADSHEET_ID: SCRIPT_PROP.getProperty("SPREADSHEET_ID"),
  FIREBASE_URL: SCRIPT_PROP.getProperty("FIREBASE_URL"),
  FIREBASE_SECRET: SCRIPT_PROP.getProperty("FIREBASE_SECRET"),
  GIF_BREATHING_URL: SCRIPT_PROP.getProperty("GIF_BREATHING_URL"),
};

const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}`;
const TELEGRAM_SEND_MESSAGE_URL = `${TELEGRAM_BASE_URL}/sendMessage`;
const TELEGRAM_ANSWER_CALLBACK_URL = `${TELEGRAM_BASE_URL}/answerCallbackQuery`;

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

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
    detail:
      "sebut benda/objek di sekitarmu + detail visual (warna, bentuk, ukuran)",
  },
  STEP_4_FEEL: {
    label: "✋ 4 Hal yang Kamu Rasakan (Eksternal)",
    target: 4,
    verb: "sentuh/rasakan",
    detail:
      "sebut benda di dekatmu + tekstur/suhu (kasar, halus, dingin, hangat)",
  },
  STEP_3_HEAR: {
    label: "👂 3 Suara yang Kamu Dengar",
    target: 3,
    verb: "dengar",
    detail:
      "sebut sumber suara dari luar ruangan/sekitarmu (kipas, kendaraan, suara hewan)",
  },
  STEP_2_SMELL: {
    label: "👃 2 Bau yang Kamu Cium",
    target: 2,
    verb: "cium",
    detail:
      "sebut aroma spesifik di udara sekitarmu (wangi parfum, bau makanan, udara netral)",
  },
  STEP_1_TASTE: {
    label: "👅 1 Objek Terjauh yang Kamu Pandang",
    target: 1,
    verb: "pandang",
    detail:
      "sebut 1 objek terjauh di luar ruangan yang bisa kamu pandang saat ini",
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
// STATIC TEMPLATE TEXTS & FALLBACK MESSAGES
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
• \`/grounding\` - Teknik 5-4-3-2-1 Sensory Grounding (meredakan cemas instan).
• \`/breathing\` - 🫁 Latihan napas Box Breathing (4-4-4-4) dengan panduan visual GIF.
• \`/fokus_luar\` - 🧩 Latihan 1 menit menunda body scanning & mengalihkan perhatian keluar.
• \`/win\` - 🏆 Pesan penguatan dari catatan positifmu di masa lalu.
• \`/stats\` - 📊 Statistik emosi & insight klinis dari data CBT-mu.`;

const FALLBACK_DEEPSEEK_ERROR =
  "Maaf, sistem sedang mengalami sedikit gangguan.";
const FALLBACK_DEEPSEEK_UNREACHABLE =
  "Maaf, sistem sedang tidak dapat dijangkau.";

const DEFAULT_ANCHOR_SENTENCE =
  "Sensasi fisik itu cuma background noise. Biarkan lewat, fokuskan mata ke depan.";

const ANCHOR_PRESETS = [
  "Sensasi fisik itu cuma background noise. Biarkan lewat, fokuskan mata ke depan.",
  "Tubuh cuma lagi melepaskan sisa energi. Kembalikan perhatian ke aktivitas luar.",
  "Jangan dianalisis. Lempar senter perhatianmu ke sekelilingmu sekarang.",
];

const DEFAULT_MORNING_GREETING =
  "Selamat pagi! Bangun tidur dengan tenang ya. Ingat, kamu sudah melangkah sejauh ini dan selalu berhasil melewati setiap rasa cemas dengan baik. Tubuh dan pikiranmu sebenarnya jauh lebih tangguh dari apa yang sering kamu khawatirkan.";
