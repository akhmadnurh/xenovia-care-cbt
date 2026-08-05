// ====================================================
// breathingHandler.js — LATIHAN NAPAS BOX BREATHING
// ====================================================

const BREATHING_CAPTION = `🫁 **Latihan Napas Box Breathing (4-4-4-4)**

Ikuti ritme animasi di atas secara perlahan:
1. 🫁 **Tarik Napas** saat lingkaran mengembang (4 detik)
2. ⏸️ **Tahan Napas** saat lingkaran penuh (4 detik)
3. 🌬️ **Hembuskan** saat lingkaran menguncup (4 detik)
4. ⏸️ **Tahan Napas** saat lingkaran kecil (4 detik)

Lakukan 3–5 siklus sampai detak jantung melambat dan emosi terasa lebih tenang.`;

const handleBreathing = (chatId) => {
  try {
    sendTelegramAnimation(chatId, CONFIG.GIF_BREATHING_URL, BREATHING_CAPTION);
  } catch (err) {
    Logger.log(`Breathing error: ${err}`);
    sendTelegramMessage(
      chatId,
      "Gagal mengirim latihan napas, silakan coba lagi.",
    );
  }
};
