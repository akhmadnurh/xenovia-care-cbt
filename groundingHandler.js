// ====================================================
// groundingHandler.js — TEKNIK GROUNDING 5-4-3-2-1
// ====================================================

const handleStartGrounding = (chatId) => {
  try {
    const props = PropertiesService.getUserProperties();
    props.setProperty(`GROUNDING_STATE_${chatId}`, "STEP_5_SEE");
    props.setProperty(`GROUNDING_ITEMS_${chatId}`, "[]");

    const msg = `🌿 *Teknik Grounding 5-4-3-2-1*

Teknik ini membantu menenangkan sistem sarafmu dengan menghubungkan kembali pikiran ke lingkungan sekitar melalui panca indera.

Mari kita mulai!

*${GROUNDING_LABELS.STEP_5_SEE.label}*

Sebutkan 5 benda atau objek yang kamu lihat di sekitarmu saat ini.
✨ Setiap benda WAJIB disertai deskripsi visualnya ya.
Contoh: *"Buku bersampul biru di atas meja"*, *"Bantal sofa berwarna krem"*, *"Lampu kamar berbentuk bulat"*`;

    sendTelegramMessage(chatId, msg);
  } catch (err) {
    Logger.log(`Grounding start error: ${err}`);
    sendTelegramMessage(
      chatId,
      "Gagal memulai sesi grounding, silakan coba lagi.",
    );
  }
};

const processGroundingStep = (chatId, userMessage, currentStep) => {
  const props = PropertiesService.getUserProperties();
  const itemsJson = props.getProperty(`GROUNDING_ITEMS_${chatId}`) ?? "[]";
  const items = JSON.parse(itemsJson);

  const stepInfo = GROUNDING_LABELS[currentStep];
  const targetCount = stepInfo.target;

  const evaluationPrompt = `Kamu adalah Evaluator Teknik Grounding 5-4-3-2-1 yang ketat dan teliti.

LANGKAH SAAT INI: ${stepInfo.label}
TARGET: Sebutkan ${targetCount} objek/hal dengan deskripsi detail.
PETUNJUK DESKRIPSI: ${stepInfo.detail}

TUGAS:
1. Evaluasi jawaban user di bawah ini.
2. Ekstrak item-item VALID & DESKRIPTIF dari jawaban user ke dalam JSON Array of strings.
3. Aturan validasi:
   - HANYA item yang menyertakan deskripsi/detail spesifik yang valid.
   - TOLAK item yang hanya menyebutkan nama benda singkat (misal: "daun", "meja", "kipas").
   - DILARANG KERAS menerima sensasi fisik internal tubuh, pakaian yang sedang dipakai, atau otot tubuh. Fokus harus 100% pada objek eksternal/benda di sekitar.
   - Untuk STEP_5_SEE: Wajib ada detail visual (warna, bentuk, ukuran, posisi) dari benda/objek sekitar.
   - Untuk STEP_4_FEEL: Wajib ada tekstur/suhu (kasar, halus, dingin, hangat) dari benda di dekatmu (meja, dinding, casing HP).
   - Untuk STEP_3_HEAR: Wajib sebut sumber suara dari luar ruangan/sekitarmu (bunyi AC, suara kendaraan, suara kucing).
   - Untuk STEP_2_SMELL: Wajib sebut aroma spesifik di udara sekitarmu (wangi parfum, bau makanan, udara ruangan netral).
   - Untuk STEP_1_TASTE: Wajib sebut objek terjauh di luar ruangan yang bisa kamu pandang saat ini.
4. Jika item sudah ada di daftar yang sudah terkumpul sebelumnya, jangan duplikat.
5. Gabungkan item baru yang valid dengan item yang sudah ada.

ITEM SEBELUMNYA: ${JSON.stringify(items)}

JAWABAN USER: "${userMessage}"

Keluarkan JSON dengan format EXACT berikut (hanya JSON, tanpa markdown, tanpa pembungkus):
{ "valid_items": ["item1", "item2"], "total_valid": number, "is_complete": boolean, "feedback": "string pesan untuk user" }

Aturan:
- "valid_items": array item baru yang valid + item sebelumnya (gabungan)
- "total_valid": jumlah total item valid setelah digabung
- "is_complete": true jika total_valid >= ${targetCount}
- "feedback":
  * Jika ada item yang ditolak (tanpa deskripsi atau melanggar aturan eksternal), beritahu item mana dan minta deskripsikan ulang dengan fokus pada objek eksternal.
  * Jika total_valid < ${targetCount}, beri semangat dan minta user menyebutkan ${targetCount - items.length} sisanya dengan deskripsi.
  * Jika is_complete = true, beri apresiasi singkat.`;

  let validItems = [...items];
  let isComplete = false;
  let feedback =
    "Terima kasih! Bisa sebutkan lagi dengan deskripsi yang lebih detail?";

  const aiRes = callGemini(evaluationPrompt, 0.2);
  try {
    const startIdx = aiRes.indexOf("{");
    const endIdx = aiRes.lastIndexOf("}");
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonStr = aiRes.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);
      validItems = parsed.valid_items ?? validItems;
      isComplete = parsed.is_complete ?? false;
      feedback = parsed.feedback ?? feedback;
    }
  } catch (err) {
    Logger.log(`Grounding parse error: ${err}`);
  }

  props.setProperty(`GROUNDING_ITEMS_${chatId}`, JSON.stringify(validItems));

  if (isComplete) {
    const stepIndex = GROUNDING_STEPS.indexOf(currentStep);
    if (stepIndex < GROUNDING_STEPS.length - 1) {
      const nextStep = GROUNDING_STEPS[stepIndex + 1];
      props.setProperty(`GROUNDING_STATE_${chatId}`, nextStep);
      return `✅ *Bagus!* Langkah ${currentStep.replace("STEP_", "").replace("_", " ").toLowerCase()} selesai! ${feedback}

Sekarang lanjut ke langkah berikutnya:

*${GROUNDING_LABELS[nextStep].label}*

Sebutkan ${GROUNDING_LABELS[nextStep].target} hal yang kamu ${GROUNDING_LABELS[nextStep].verb}.
✨ ${GROUNDING_LABELS[nextStep].detail}`;
    } else {
      props.deleteProperty(`GROUNDING_STATE_${chatId}`);
      props.deleteProperty(`GROUNDING_ITEMS_${chatId}`);
      return `🌟 *Grounding 5-4-3-2-1 Selesai!*

Kamu berhasil menenangkan sistem sarafmu dengan menghubungkan kembali kesadaran ke lingkungan sekitar. Semoga perasaanmu lebih tenang dan stabil sekarang. 🧘‍♂️

Kapan saja cemas datang lagi, kamu bisa ulangi teknik ini kapanpun. Aku akan selalu siap mendengarkan ceritamu 💙`;
    }
  }

  return feedback;
};
