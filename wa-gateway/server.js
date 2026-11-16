// Gateway WhatsApp untuk chatbot lapak.
// Pesan WA masuk -> diteruskan ke API chatbot (yang sama dengan website, di Vercel) -> balasan dikirim ke WA.
// Jadi website dan WhatsApp memakai otak chatbot & data produk yang SAMA.
//
// Jalankan di komputer lokal:  npm start   lalu buka http://localhost:3002 untuk scan QR.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

// ---- Baca .env sederhana ----
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const CHATBOT_API_URL = process.env.CHATBOT_API_URL || "http://localhost:3000/api/chat";
const PORT = Number(process.env.GATEWAY_PORT || 3002);

// ---- Riwayat chat per nomor (maks 6 pesan, kadaluarsa 20 menit) ----
const sessions = new Map();
const MAX_HISTORY = 6;
const TTL = 20 * 60 * 1000;

function getHistory(id) {
  const s = sessions.get(id);
  if (!s || Date.now() - s.lastActive > TTL) { sessions.delete(id); return []; }
  return s.messages;
}
function pushHistory(id, userMsg, botMsg) {
  const messages = [...getHistory(id), { role: "user", content: userMsg }, { role: "assistant", content: botMsg }].slice(-MAX_HISTORY);
  sessions.set(id, { messages, lastActive: Date.now() });
}

// ---- Status untuk halaman dashboard sederhana ----
let status = { state: "starting", qr: null, number: null, lastMessage: null };

async function askChatbot(senderId, message) {
  const res = await fetch(CHATBOT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: getHistory(senderId), channel: "whatsapp" })
  });
  if (!res.ok) throw new Error(`API chatbot membalas status ${res.status}`);
  const data = await res.json();
  return data;
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "lapak-gateway" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--disable-gpu"]
  }
});

client.on("qr", qr => {
  status = { ...status, state: "qr", qr };
  console.log("\n========== SCAN QR INI DENGAN WHATSAPP (Perangkat tertaut) ==========");
  qrcode.generate(qr, { small: true });
  console.log(`Atau buka http://localhost:${PORT} untuk melihat QR yang lebih besar.\n`);
});
client.on("authenticated", () => console.log("✅ Autentikasi WhatsApp berhasil"));
client.on("auth_failure", m => { status.state = "auth_failure"; console.error("❌ Autentikasi gagal:", m); });
client.on("ready", () => {
  status = { ...status, state: "ready", qr: null, number: client.info?.wid?.user || null };
  console.log("🤖 Gateway WhatsApp siap digunakan");
  console.log(`   Pesan diteruskan ke: ${CHATBOT_API_URL}`);
});
client.on("disconnected", reason => {
  status = { ...status, state: "disconnected", qr: null };
  console.log("⚠️  WhatsApp terputus:", reason);
});

client.on("message", async msg => {
  try {
    if (msg.fromMe || !msg.body) return;
    const personal = msg.from.endsWith("@c.us") || msg.from.endsWith("@lid");
    if (!personal) return; // abaikan grup & status

    const text = msg.body.trim();
    console.log(`📩 [${msg.from}] ${text}`);
    const chat = await msg.getChat();
    chat.sendStateTyping().catch(() => {});

    const data = await askChatbot(msg.from, text);
    const reply = data.reply || "Maaf, terjadi kesalahan. Silakan coba lagi.";
    await msg.reply(reply);
    pushHistory(msg.from, text, reply);
    status.lastMessage = new Date().toLocaleTimeString("id-ID");
    console.log(`📤 (${data.source || "-"}) ${reply.slice(0, 120).replace(/\n/g, " ")}${reply.length > 120 ? "…" : ""}`);
  } catch (err) {
    console.error("Gagal memproses pesan:", err.message);
    try { await msg.reply("Mohon maaf, asisten sedang mengalami gangguan. Silakan coba beberapa saat lagi 🙏"); } catch {}
  }
});

// ---- Halaman status + QR di http://localhost:3002 ----
http.createServer((req, res) => {
  if (req.url === "/status") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ...status, api: CHATBOT_API_URL }));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gateway WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f5;margin:0;display:grid;place-items:center;min-height:100vh}
.box{background:#fff;padding:32px;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 6px}p{color:#555;font-size:14px}.ok{color:#16a34a;font-weight:700}code{font-size:12px;word-break:break-all}</style></head>
<body><div class="box"><h1>Gateway WhatsApp Chatbot</h1><div id="s">Memuat…</div><p>API chatbot: <code>${CHATBOT_API_URL}</code></p></div>
<script>
async function tick(){const d=await (await fetch('/status')).json();const s=document.getElementById('s');
if(d.state==='ready'){s.innerHTML='<p class="ok">✅ Terhubung'+(d.number?' ('+d.number.replace(/^(\\d{4})\\d+(\\d{3})$/,'$1xxxx$2')+')':'')+'</p><p>Bot siap membalas pesan.'+(d.lastMessage?' Pesan terakhir: '+d.lastMessage:'')+'</p>';}
else if(d.state==='qr'&&d.qr){s.innerHTML='<p>Buka WhatsApp → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b>, lalu scan:</p><img width="260" height="260" alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data='+encodeURIComponent(d.qr)+'">';}
else{s.innerHTML='<p>Status: '+d.state+' — tunggu sebentar…</p>';}}
tick();setInterval(tick,3000);
</script></body></html>`);
}).listen(PORT, () => console.log(`🌐 Dashboard gateway: http://localhost:${PORT}`));

console.log("⏳ Menyalakan WhatsApp Web (30–60 detik pertama kali)…");
client.initialize();

async function shutdown() {
  console.log("\nMenutup gateway…");
  try { await client.destroy(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
