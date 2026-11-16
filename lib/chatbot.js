// Inti chatbot yang dipakai bersama oleh website (api/chat.js) dan gateway WhatsApp.
// Alur berlapis (sama seperti praktikum):
//   1. Sapaan / terima kasih  -> template (tanpa AI)
//   2. FAQ toko (store.config.json) -> jawaban manual (tanpa AI)
//   3. Pertanyaan lain -> RAG (data/products.csv) + riwayat chat + Groq LLM
const path = require("path");
const { RAGEngine, formatRupiah } = require("./rag");
const store = require("../store.config.json");

const rag = new RAGEngine(path.join(__dirname, "..", "data", "products.csv"));

const MAX_HISTORY = 6;

function isGreeting(q) {
  const greetings = ["halo", "hai", "hi", "hey", "hello", "hei", "p", "ping", "test", "tes", "pagi", "siang",
    "sore", "malam", "selamat pagi", "selamat siang", "selamat sore", "selamat malam", "assalamualaikum",
    "assalamu'alaikum", "assalamu alaikum", "permisi", "halo kak", "hai kak", "halo min", "hai min", "kak", "min"];
  if (greetings.includes(q)) return true;
  if (/^(halo|hai|hi|hey|hello|hei|selamat\s+(pagi|siang|sore|malam)|assalamu\s*'?alaikum|permisi)\b/.test(q)) {
    // salam + pertanyaan produk -> bukan sapaan murni
    return q.split(/\s+/).length <= 3 && !rag.search(q).items.length;
  }
  return false;
}

function isThanks(q) {
  return /^(terima\s*kasih|terimakasih|makasih|makasi|thanks|thank\s*you|thx|tq|ok(e|ey)?\s*(makasih|thanks))\b/.test(q)
    && q.split(/\s+/).length <= 5;
}

function matchFaq(q) {
  for (const item of store.faq || []) {
    if ((item.keywords || []).some(k => q.includes(k.toLowerCase()))) return item.jawaban;
  }
  return null;
}

function contactBlock(channel) {
  const b = channel === "whatsapp" ? "*" : "**";
  const lines = [`🛍️ ${b}Toko Shopee:${b} ${store.shopeeUrl}`];
  if (store.whatsapp) lines.push(`📞 ${b}WhatsApp:${b} wa.me/${store.whatsapp}`);
  if (store.lokasi) lines.push(`📍 ${b}Lokasi:${b} ${store.lokasi}`);
  return lines.join("\n");
}

function buildSystemPrompt(ragContext, channel) {
  const bold = channel === "whatsapp"
    ? "Gunakan SATU bintang untuk teks tebal, contoh: *teks* (JANGAN pakai **dua bintang**). Jangan pakai heading #."
    : "Gunakan **dua bintang** untuk teks tebal. Jangan pakai heading # atau tabel.";

  return `Anda adalah asisten katalog yang membantu pelanggan mengenal produk-produk toko "${store.namaToko}" di Shopee (${store.shopeeUrl}).
${store.deskripsi ? "Tentang toko: " + store.deskripsi : ""}
Jawab dalam Bahasa Indonesia yang ramah, natural, singkat, dan rapi.

ATURAN KEAKURATAN (WAJIB):
1. Jawab HANYA berdasarkan data produk pada KONTEKS KATALOG di bawah. Jangan mengarang produk, harga, varian, ukuran, warna, stok, atau spesifikasi yang tidak tertulis.
2. Selalu sebutkan nama produk dan harga persis seperti di katalog.
3. Saat merekomendasikan produk, sertakan link produknya (kolom Link) agar pelanggan bisa langsung membuka di Shopee.
4. Jika produk yang ditanyakan tidak ada di konteks, katakan dengan sopan bahwa produk itu tidak tersedia di toko ini, lalu tawarkan produk serupa dari konteks jika ada.
5. Jika ditanya detail yang tidak ada di data (stok terkini, ukuran detail, ongkir, dsb.), arahkan pelanggan untuk cek halaman produk di Shopee atau hubungi kontak toko:
${contactBlock(channel)}
6. Jangan menyebut istilah teknis internal seperti "CSV", "konteks", "data scraping", atau "sistem".
7. Jangan menyapa "selamat datang" lagi jika percakapan sudah berjalan.

FORMAT:
- ${bold}
- Daftar produk ditulis per baris dengan bullet (•), maksimal 5 produk kecuali diminta lebih.
- Format setiap produk: nama — harga — (info singkat) — link.
- Selesaikan kalimat dengan tuntas.

KONTEKS KATALOG:
${ragContext || "(Tidak ada produk yang cocok dengan pertanyaan ini. Jika pertanyaan tentang produk, sampaikan bahwa produk tidak ditemukan di toko ini dan sarankan pelanggan menyebutkan nama/jenis produk lain.)"}`;
}

function cleanReply(text, channel) {
  let t = String(text || "");
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, ""); // buang "pikiran" model reasoning
  if (channel === "whatsapp") t = t.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(h => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-MAX_HISTORY)
    .map(h => ({ role: h.role, content: h.content.slice(0, 2000) }));
}

/**
 * @param {object} opts
 * @param {string} opts.message  pesan pengguna
 * @param {Array}  opts.history  riwayat [{role, content}]
 * @param {object} opts.groq     instance Groq SDK (boleh null)
 * @param {"web"|"whatsapp"} opts.channel
 * @returns {Promise<{reply: string, source: string}>}
 */
async function answer({ message, history = [], groq, channel = "web" }) {
  const msg = String(message || "").trim().slice(0, 500);
  const q = msg.toLowerCase();
  const hist = sanitizeHistory(history);
  const b = channel === "whatsapp" ? "*" : "**";

  if (!msg) return { reply: "Silakan ketik pertanyaan Anda 😊", source: "template" };

  // 1. Template sapaan & terima kasih
  if (isGreeting(q)) {
    return {
      reply: `Halo! 👋 Selamat datang di ${b}${store.namaToko}${b}.\n\nAda yang bisa kami bantu? Kakak bisa tanya produk, harga, rekomendasi, atau produk termurah/terlaris 😊`,
      source: "template"
    };
  }
  if (isThanks(q)) {
    return {
      reply: `Sama-sama! Terima kasih sudah mampir ke ${b}${store.namaToko}${b} 🙏\n\nSilakan checkout langsung di Shopee ya: ${store.shopeeUrl}`,
      source: "template"
    };
  }

  // 2. FAQ toko
  const faq = matchFaq(q);
  if (faq) return { reply: cleanReply(faq.replace(/\{\{kontak\}\}/g, contactBlock(channel)), channel), source: "faq" };

  // 3. RAG + LLM
  let ragContext = rag.buildContext(msg);
  if (!ragContext && hist.length) {
    // pertanyaan lanjutan ("berapa harganya?") -> pakai pertanyaan user sebelumnya
    const prev = hist.filter(h => h.role === "user").slice(-2).map(h => h.content).join(" ");
    ragContext = rag.buildContext(`${prev} ${msg}`);
  }

  if (!groq) {
    return { reply: fallbackReply(ragContext, channel), source: "fallback" };
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(ragContext, channel) },
    ...hist,
    { role: "user", content: msg }
  ];

  const models = [process.env.GROQ_MODEL || "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b"]
    .filter((m, i, arr) => m && arr.indexOf(m) === i);

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.3,
        max_tokens: Number(process.env.GROQ_MAX_TOKENS || 1200)
      });
      const content = completion?.choices?.[0]?.message?.content;
      const reply = cleanReply(content, channel);
      if (reply) return { reply, source: "ai", model };
    } catch (err) {
      console.warn(`[Groq ${model}] gagal: ${err.message}`);
    }
  }
  return { reply: fallbackReply(ragContext, channel), source: "fallback" };
}

// Jawaban cadangan jika Groq tidak tersedia: tampilkan hasil RAG apa adanya
function fallbackReply(ragContext, channel) {
  const b = channel === "whatsapp" ? "*" : "**";
  if (!ragContext) {
    return `Maaf, kami belum menemukan produk yang sesuai. Silakan lihat katalog lengkap ${b}${store.namaToko}${b} di Shopee:\n${store.shopeeUrl}`;
  }
  // buang baris ringkasan, ambil maksimal 5 produk
  const products = ragContext.split("\n\n")
    .map(s => s.slice(Math.max(0, s.indexOf("• "))))
    .filter(s => s.startsWith("• "))
    .slice(0, 5);
  return `Berikut produk yang mungkin sesuai:\n\n${products.join("\n\n")}`;
}

function getProducts() {
  return rag.products.map(({ _nama, _kategori, _tokens, _harga, _terjual, ...p }) => ({ ...p, harga_angka: _harga, terjual_angka: _terjual }));
}

module.exports = { answer, getProducts, store, rag, formatRupiah };
