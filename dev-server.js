// Server lokal untuk mencoba website sebelum di-deploy ke Vercel.
// Meniru perilaku Vercel: file statis dari folder public/ dan fungsi di folder api/.
// Jalankan: npm run dev  ->  buka http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

// Baca .env secara sederhana (tanpa library tambahan)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.WEB_PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- API: /api/<nama> -> api/<nama>.js ----
  const apiMatch = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/i);
  if (apiMatch) {
    const file = path.join(__dirname, "api", `${apiMatch[1]}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    return require(file)(req, res);
  }

  // ---- File statis dari public/ ----
  let filePath = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
  if (!fs.existsSync(filePath)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`🌐 Website berjalan di http://localhost:${PORT}`);
  console.log(process.env.GROQ_API_KEY ? "🤖 Groq API Key terdeteksi" : "⚠️  GROQ_API_KEY belum diisi di .env (chatbot memakai jawaban cadangan)");
});
