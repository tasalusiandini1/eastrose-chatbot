// Serverless function Vercel: POST /api/chat
// Body: { "message": "...", "history": [{role, content}], "channel": "web" | "whatsapp" }
const Groq = require("groq-sdk");
const { answer } = require("../lib/chatbot");

let groq = null;
function getGroq() {
  if (!groq && process.env.GROQ_API_KEY) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") return send(res, 405, { error: "Gunakan metode POST" });

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    body = body || {};

    const result = await answer({
      message: body.message,
      history: body.history,
      channel: body.channel === "whatsapp" ? "whatsapp" : "web",
      groq: getGroq()
    });
    send(res, 200, result);
  } catch (err) {
    console.error("[api/chat] error:", err);
    send(res, 500, { error: "Terjadi kesalahan pada server chatbot." });
  }
};
