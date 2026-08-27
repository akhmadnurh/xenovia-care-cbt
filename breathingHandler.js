// ====================================================
// breathingHandler.js — LATIHAN NAPAS BOX BREATHING
// ====================================================

const BREATHING_CAPTION = `🫁 **Latihan Napas (4-2-6)**

Ikuti ritme animasi di atas secara perlahan:
1. 🫁 **Tarik Napas** (4 detik)
2. ⏸️ **Tahan Napas** (2 detik)
3. 🌬️ **Hembuskan** (6 detik)

*Petunjuk Tambahan:*
Sambil mengikuti pola pernapasan, **JAGA MATAMU TETAP TERBUKA**. Gerakkan pandangan matamu menelusuri pergerakan animasi di layar. Tekan jempolmu ke permukaan meja/benda keras di dekatmu untuk mengunci perhatian ke luar.

Lakukan 5 siklus sampai detak jantung melambat dan emosi terasa lebih tenang. Anda bisa mengulang latihan setelah selesai.`;

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
