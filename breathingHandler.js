// ====================================================
// breathingHandler.js — LATIHAN NAPAS BOX BREATHING
// ====================================================

const BREATHING_CAPTION = `🫁 **Latihan Napas Box Breathing (4-4-4-4)**

Ikuti ritme animasi di atas secara perlahan:
1. 🫁 **Tarik Napas** saat lingkaran mengembang (4 detik)
2. ⏸️ **Tahan Napas** saat lingkaran penuh (4 detik)
3. 🌬️ **Hembuskan** saat lingkaran menguncup (4 detik)
4. ⏸️ **Tahan Napas** saat lingkaran kecil (4 detik)

*Petunjuk Tambahan:*
Sambil mengikuti pola pernapasan, **JAGA MATAMU TETAP TERBUKA**. Gerakkan pandangan matamu menelusuri pergerakan animasi di layar. Tekan jempolmu ke permukaan meja/benda keras di dekatmu untuk mengunci perhatian ke luar.

Lakukan 3–5 siklus sampai detak jantung melambat dan emosi terasa lebih tenang.`;

const handleBreathing = (chatId) => {
  try {
    const webAppUrl = `${ScriptApp.getService().getUrl()}?page=breathing`;
    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "🫁 Mulai Latihan Napas Interaktif",
            web_app: { url: webAppUrl },
          },
        ],
      ],
    };
    sendTelegramMessage(chatId, BREATHING_CAPTION, replyMarkup);
  } catch (err) {
    Logger.log(`Breathing error: ${err}`);
    sendTelegramMessage(
      chatId,
      "Gagal mengirim latihan napas, silakan coba lagi.",
    );
  }
};
