// ====================================================
// services.js — TELEGRAM & EXTERNAL API CLIENTS
// ====================================================

// --- Telegram API ---

const sendTypingAction = (chatId) => {
  try {
    UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/sendChatAction`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, action: "typing" }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    Logger.log(`sendTypingAction error: ${err}`);
  }
};

const sendTelegramMessage = (chatId, text, replyMarkup = null) => {
  const payload = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const resp = UrlFetchApp.fetch(TELEGRAM_SEND_MESSAGE_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  });
  return JSON.parse(resp.getContentText());
};

const answerCallbackQuery = (callbackQueryId) => {
  UrlFetchApp.fetch(TELEGRAM_ANSWER_CALLBACK_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
};

const pinTelegramMessage = (chatId, messageId) => {
  UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/pinChatMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    }),
    muteHttpExceptions: true,
  });
};

const unpinAllTelegramMessages = (chatId) => {
  UrlFetchApp.fetch(`${TELEGRAM_BASE_URL}/unpinAllChatMessages`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId }),
    muteHttpExceptions: true,
  });
};

const getTelegramFileUrl = (fileId) => {
  const response = UrlFetchApp.fetch(
    `${TELEGRAM_BASE_URL}/getFile?file_id=${fileId}`,
    { muteHttpExceptions: true },
  );
  const json = JSON.parse(response.getContentText());
  return json.ok && json.result?.file_path
    ? `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${json.result.file_path}`
    : null;
};

// --- External AI API Clients ---

const callDeepSeek = (messages, temp = 0.4) => {
  try {
    const payload = {
      model: OPENROUTER_MODEL,
      messages: messages,
      temperature: temp,
      provider: { order: ["DeepInfra"], allow_fallbacks: true },
    };
    const response = UrlFetchApp.fetch(OPENROUTER_CHAT_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(response.getContentText());
    return json.choices?.[0]?.message?.content ?? FALLBACK_DEEPSEEK_ERROR;
  } catch (err) {
    return FALLBACK_DEEPSEEK_UNREACHABLE;
  }
};

const callGemini = (promptText, temp = 0.3) => {
  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: temp },
  };
  const response = UrlFetchApp.fetch(GEMINI_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return (
    JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]
      ?.text ?? ""
  );
};

const transcribeAudioGroq = (fileUrl) => {
  try {
    const audioBlob = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true })
      .getBlob()
      .setName("voice.ogg");
    const response = UrlFetchApp.fetch(GROQ_WHISPER_URL, {
      method: "post",
      headers: { Authorization: `Bearer ${CONFIG.GROQ_API_KEY}` },
      payload: {
        file: audioBlob,
        model: "whisper-large-v3-turbo",
        language: "id",
        temperature: "0",
      },
      muteHttpExceptions: true,
    });
    return JSON.parse(response.getContentText()).text ?? "";
  } catch (err) {
    return "";
  }
};

// ====================================================
// UTILITY & HELPER FUNCTIONS
// ====================================================

const sanitizeQuotes = (text) =>
  text.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();

const sanitizeAIResponse = (text) => {
  if (!text) return text;
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const stripped = trimmed.replace(/^[\s\*]+/, "").toLowerCase();
    // Label CoT — safety layer (DeepSeek pisah reasoning di field terpisah)
    const cotLabels = [
      "user input:",
      "user:",
      "context:",
      "persona:",
      "constraints:",
      "constraints check:",
      "option ",
      "options:",
      "step ",
      "steps:",
      "reasoning:",
      "thought:",
      "thinking:",
      "internal:",
      "note:",
      "notes:",
      "response:",
    ];
    const actionVerbs = [
      "acknowledge",
      "confirm",
      "encourage",
      "ask",
      "provide",
      "offer",
      "suggest",
      "guide",
      "invite",
      "give",
    ];
    const firstWord = stripped.split(/\s+/)[0] ?? "";
    const isInstruction = actionVerbs.some((v) => firstWord.startsWith(v));
    const isConstraintBullet =
      trimmed.startsWith("**") &&
      (stripped.startsWith("no ") ||
        stripped.startsWith("do not") ||
        stripped.startsWith("don't") ||
        stripped.startsWith("tidak ") ||
        stripped.startsWith("jangan ") ||
        stripped.startsWith("gunakan ") ||
        stripped.startsWith("dilarang ") ||
        stripped.startsWith("wajib ") ||
        stripped.startsWith("hanya ") ||
        stripped.match(/^\d+\.\s/));
    if (
      cotLabels.some((p) => stripped.startsWith(p)) ||
      isInstruction ||
      isConstraintBullet
    )
      return false;
    return true;
  });
  let result = filtered.join("\n").trim();
  result = result.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
  result = result.replace(/\\n/g, "\n");
  return result;
};

const formatTimestampJakarta = () => {
  const now = new Date();
  const tz = "Asia/Jakarta";
  return {
    dayName: DAY_NAMES[now.getDay()],
    dateStr: Utilities.formatDate(now, tz, "dd/MM/yyyy"),
    timeStr: Utilities.formatDate(now, tz, "HH:mm:ss"),
  };
};
