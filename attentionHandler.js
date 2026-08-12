// ====================================================
// attentionHandler.js — DELAY BODY SCAN / ATTENTION SHIFT INTERVENTION
// ====================================================

const VISUAL_CHALLENGES = [
  {
    instruction: "Cari 2 benda yang warnanya biru, merah, atau kuning!",
    criteria: "warna (biru/merah/kuning)",
  },
  {
    instruction:
      "Cari 2 benda yang bentuknya segitiga, lingkaran, atau persegi!",
    criteria: "bentuk (segitiga/lingkaran/persegi)",
  },
  {
    instruction: "Cari 2 benda yang berbahan kayu, plastik, atau kaca!",
    criteria: "material (kayu/plastik/kaca)",
  },
  {
    instruction:
      "Cari 2 benda yang memiliki teks atau tulisan di permukaannya!",
    criteria: "memiliki tulisan/teks",
  },
];

// Step-specific prompt builders — each step has strictly isolated evaluation rules
function _buildEvalPrompt(stepType, instruction, previousItems, userResponse) {
  if (stepType === "SUARA") {
    return _buildStep1Prompt(userResponse);
  }
  if (stepType.startsWith("BENDA VISUAL")) {
    return _buildStep2Prompt(
      instruction,
      stepType,
      previousItems,
      userResponse,
    );
  }
  return _buildStep3Prompt(userResponse);
}

function _buildStep1Prompt(userResponse) {
  return `Kamu adalah evaluator empatik untuk latihan PENDENGARAN (auditori) Xenovia Care.

JAWABAN USER: "${userResponse}"

ATURAN EVALUASI TANTANGAN 1 — SUARA (SANGAT KETAT):
- Tugasmu HANYA menilai apakah user menyebutkan minimal 1 sumber suara EKSTERNAL (contoh: kipas laptop, suara burung, detik jam, suara angin, musik, langkah kaki, dll).
- DILARANG KERAS meminta detail visual (warna, bentuk, ukuran). Ini latihan PENDENGARAN, bukan penglihatan!
- Jika user menyebutkan 1 sumber suara eksternal (meskipun singkat atau ada kata tambahan/candaan), anggap VALID 100%.
- SATU-SATUNYA alasan menolak: user menyebutkan sensasi fisik internal tubuh (detak jantung, nafas dalam, pusing, dll) BUKAN suara eksternal.
- Ekstrak nama suara yang disebutkan user ke dalam extracted_items.

Keluarkan JSON dengan format EXACT berikut (hanya JSON, tanpa markdown, tanpa pembungkus):
{
  "extracted_items": ["nama suara"],
  "total_valid": number,
  "is_complete": boolean,
  "feedback": "Pesan apresiatif hangat yang menyebut nama suara yang user sebutkan. Jika tidak valid, minta fokus ke suara eksternal di sekitar dengan lembut."
}`;
}

function _buildStep2Prompt(instruction, stepType, previousItems, userResponse) {
  const prevContext =
    previousItems.length > 0
      ? `\nBENDA YANG SUDAH TERCATAT SEBELUMNYA: ${JSON.stringify(previousItems)}`
      : "";

  return `Kamu adalah evaluator empatik untuk latihan VISUAL (penglihatan) Xenovia Care.

INSTRUKSI TANTANGAN: "${instruction}"${prevContext}
JAWABAN USER: "${userResponse}"

ATURAN EVALUASI TANTANGAN 2 — BENDA VISUAL:
- Ekstrak nama-nama benda EKSTERNAL dari jawaban user yang sesuai kriteria: ${stepType.replace("BENDA VISUAL (kriteria: ", "").replace(")", "")}.
- Terima jawaban meskipun ada kata tambahan atau candaan — yang penting benda eksternalnya ada dan sesuai kriteria.
- JANGAN duplikat benda yang sudah ada di BENDA YANG SUDAH TERCATAT SEBELUMNYA.
- Gabungkan benda baru yang valid dengan benda sebelumnya untuk menghitung total_valid.
- Target: 2 benda. Jika total_valid >= 2, set is_complete = true.
- SATU-SATUNYA alasan menolak: user menyebutkan sensasi fisik internal tubuh.

Keluarkan JSON dengan format EXACT berikut (hanya JSON, tanpa markdown, tanpa pembungkus):
{
  "extracted_items": ["semua benda valid termasuk yang sebelumnya"],
  "total_valid": number,
  "is_complete": boolean,
  "feedback": "Jika lengkap: puji kedua benda dengan menyebut namanya. Jika baru 1: puji benda pertama dengan menyebut namanya (contoh: 'Bagus! [nama benda] sudah tercatat 👍'), lalu minta 1 benda sisanya dengan ramah."
}`;
}

function _buildStep3Prompt(userResponse) {
  return `Kamu adalah evaluator empatik untuk latihan PERABAAN (taktil) Xenovia Care.

JAWABAN USER: "${userResponse}"

ATURAN EVALUASI TANTANGAN 3 — TEKSTUR/PERABAAN (SANGAT KETAT):
- Tugasmu HANYA mengekstrak kata sifat tekstur/sensasi rabaan dari jawaban user (contoh: halus, kasar, dingin, hangat, licin, keras, lembut, dll).
- Jika kata tekstur ADA di dalam kalimat user (meskipun ada nama benda atau kata tambahan), EKSTRAK kata tersebut dan anggap VALID 100%.
- Contoh: "pencukur bulu terasa halus banget" → ekstrak "halus" → VALID.
- DILARANG KERAS menolak hanya karena ada kata tambahan di luar kata tekstur!
- SATU-SATUNYA alasan menolak: user menyebutkan sensasi fisik internal tubuh (pusing, mual, detak jantung, dll).

Keluarkan JSON dengan format EXACT berikut (hanya JSON, tanpa markdown, tanpa pembungkus):
{
  "extracted_items": ["kata tekstur yang diekstrak"],
  "total_valid": number,
  "is_complete": boolean,
  "feedback": "Pesan apresiatif hangat yang menyebut tekstur yang user rasakan. Jika tidak valid, minta sentuh benda di sekitar dan deskripsikan teksturnya dengan lembut."
}`;
}

function handleStartAttentionShift(chatId) {
  try {
    const props = PropertiesService.getUserProperties();
    props.setProperty(`ATTENTION_STATE_${chatId}`, "STEP_1");
    props.deleteProperty(`ATTENTION_ITEMS_${chatId}`);

    // ponytail: Math.random is used for simple random selection of visual challenges. Upgrade to cryptographically secure random if needed.
    const challengeIdx = Math.floor(Math.random() * VISUAL_CHALLENGES.length);
    props.setProperty(
      `ATTENTION_CHALLENGE_IDX_${chatId}`,
      String(challengeIdx),
    );

    const msg = `🧩 *Latihan Fokus Luar (Attention Shift)*

Latihan 1 menit ini dirancang khusus untuk membantumu menunda dorongan menganalisis tubuh (body scanning) dan mengalihkan perhatian sepenuhnya ke lingkungan luar.

Mari kita mulai!

*Tantangan 1:*
👂 **Dengarkan baik-baik:** Sebutkan 1 suara paling pelan yang bisa kamu tangkap di sekitarmu saat ini!`;

    sendTelegramMessage(chatId, msg);
  } catch (err) {
    Logger.log(`Attention shift start error: ${err}`);
    sendTelegramMessage(
      chatId,
      "Gagal memulai latihan fokus luar, silakan coba lagi.",
    );
  }
}

function _callEvaluator(stepType, instruction, previousItems, userResponse) {
  const prompt = _buildEvalPrompt(
    stepType,
    instruction,
    previousItems,
    userResponse,
  );
  const aiRes = callGemini(prompt, 0.3);
  try {
    const startIdx = aiRes.indexOf("{");
    const endIdx = aiRes.lastIndexOf("}");
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const parsed = JSON.parse(aiRes.substring(startIdx, endIdx + 1));
      return {
        extractedItems: parsed.extracted_items ?? [],
        totalValid: parsed.total_valid ?? 0,
        isComplete: parsed.is_complete ?? false,
        feedback:
          parsed.feedback ?? "Coba sebutkan objek eksternal di sekitarmu ya.",
      };
    }
  } catch (err) {
    Logger.log(`Attention evaluator parse error: ${err}`);
  }
  // Fallback: treat as valid to avoid blocking user
  return { extractedItems: [], totalValid: 1, isComplete: true, feedback: "" };
}

function processAttentionShiftStep(chatId, userMessage, currentStep) {
  if (currentStep === "STEP_1") {
    return _processStep1(chatId, userMessage);
  }
  if (currentStep === "STEP_2") {
    return _processStep2(chatId, userMessage);
  }
  if (currentStep === "STEP_3") {
    return _processStep3(chatId, userMessage);
  }
  return "Terjadi kesalahan dalam sesi latihan.";
}

function _processStep1(chatId, userMessage) {
  const props = PropertiesService.getUserProperties();
  const result = _callEvaluator(
    "SUARA",
    "Sebutkan 1 suara paling pelan yang bisa kamu tangkap di sekitarmu saat ini!",
    [],
    userMessage,
  );

  if (!result.isComplete) return result.feedback;

  props.setProperty(`ATTENTION_STATE_${chatId}`, "STEP_2");
  props.setProperty(`ATTENTION_ITEMS_${chatId}`, "[]");

  const challengeIdx = Number.parseInt(
    props.getProperty(`ATTENTION_CHALLENGE_IDX_${chatId}`) ?? "0",
    10,
  );
  const challenge = VISUAL_CHALLENGES[challengeIdx] ?? VISUAL_CHALLENGES[0];

  const transition = result.feedback
    ? `${result.feedback}\n\n`
    : "✅ Bagus! Telingamu sudah menangkap suara di sekitar.\n\n";

  return `${transition}Sekarang lanjut ke tantangan berikutnya:

*Tantangan 2:*
👁️ **Lihat sekelilingmu:** ${challenge.instruction}`;
}

function _processStep2(chatId, userMessage) {
  const props = PropertiesService.getUserProperties();
  const challengeIdx = Number.parseInt(
    props.getProperty(`ATTENTION_CHALLENGE_IDX_${chatId}`) ?? "0",
    10,
  );
  const challenge = VISUAL_CHALLENGES[challengeIdx] ?? VISUAL_CHALLENGES[0];
  const prevItems = JSON.parse(
    props.getProperty(`ATTENTION_ITEMS_${chatId}`) ?? "[]",
  );

  const result = _callEvaluator(
    `BENDA VISUAL (kriteria: ${challenge.criteria})`,
    challenge.instruction,
    prevItems,
    userMessage,
  );

  const allItems =
    result.extractedItems.length > 0 ? result.extractedItems : prevItems;
  props.setProperty(`ATTENTION_ITEMS_${chatId}`, JSON.stringify(allItems));

  if (!result.isComplete) return result.feedback;

  props.setProperty(`ATTENTION_STATE_${chatId}`, "STEP_3");
  props.deleteProperty(`ATTENTION_ITEMS_${chatId}`);

  const transition = result.feedback
    ? `${result.feedback}\n\n`
    : "✅ Mantap! Mata dan pikiranmu mulai terbiasa melihat objek luar secara objektif.\n\n";

  return `${transition}Tantangan terakhir:

*Tantangan 3:*
✋ **Sentuh benda terdekat:** Jelaskan teksturnya dalam 1 kata (dingin/kasar/halus)!`;
}

function _processStep3(chatId, userMessage) {
  const props = PropertiesService.getUserProperties();
  const result = _callEvaluator(
    "TEKSTUR",
    "Jelaskan tekstur benda yang kamu sentuh (dingin/kasar/halus/dll)!",
    [],
    userMessage,
  );

  if (!result.isComplete) return result.feedback;

  props.deleteProperty(`ATTENTION_STATE_${chatId}`);
  props.deleteProperty(`ATTENTION_CHALLENGE_IDX_${chatId}`);
  props.deleteProperty(`ATTENTION_ITEMS_${chatId}`);

  const closing = result.feedback ? `${result.feedback}\n\n` : "";

  return `${closing}🌟 *Latihan Fokus Luar Selesai!*

Hebat! Kamu baru saja berhasil menunda dorongan body scanning selama 1 menit penuh.

Ingat, sensasi fisik yang kamu rasakan hanyalah *background noise* (suara latar belakang) yang tidak perlu dianalisis atau dicari solusinya saat ini. Biarkan ia ada di sana, sementara kamu tetap melanjutkan aktivitas dan mengarahkan perhatianmu ke dunia luar. 💙`;
}

function _webStartAttentionShift() {
  const props = PropertiesService.getUserProperties();
  props.setProperty(`ATTENTION_STATE_${WEB_CHAT_ID}`, "STEP_1");
  props.deleteProperty(`ATTENTION_ITEMS_${WEB_CHAT_ID}`);

  // ponytail: Math.random is used for simple random selection of visual challenges. Upgrade to cryptographically secure random if needed.
  const challengeIdx = Math.floor(Math.random() * VISUAL_CHALLENGES.length);
  props.setProperty(
    `ATTENTION_CHALLENGE_IDX_${WEB_CHAT_ID}`,
    String(challengeIdx),
  );

  const text = `🧩 *Latihan Fokus Luar (Attention Shift)*

Latihan 1 menit ini dirancang khusus untuk membantumu menunda dorongan menganalisis tubuh (body scanning) dan mengalihkan perhatian sepenuhnya ke lingkungan luar.

Mari kita mulai!

*Tantangan 1:*
👂 **Dengarkan baik-baik:** Sebutkan 1 suara paling pelan yang bisa kamu tangkap di sekitarmu saat ini!`;

  return { type: "text", text };
}

// ponytail: Deprecated old validation function.
function validateAttentionResponse(step, instruction, userResponse) {
  return { valid: true, feedback: "" };
}
