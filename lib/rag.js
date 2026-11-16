// Mesin RAG: mengambil (retrieve) produk yang relevan dari data/products.csv
// lalu menyusunnya menjadi konteks teks untuk LLM.
const fs = require("fs");
const path = require("path");
const { csvToObjects } = require("./csv");

// Kata umum yang tidak membantu pencarian produk
const STOPWORDS = new Set([
  "apa", "ada", "aja", "saja", "yang", "dan", "atau", "untuk", "buat", "dengan", "di", "ke", "dari",
  "ini", "itu", "dong", "deh", "kak", "min", "gan", "sis", "bang", "mau", "ingin", "pengen", "cari",
  "carikan", "tolong", "bisa", "boleh", "nggak", "gak", "tidak", "berapa", "harga", "harganya",
  "produk", "barang", "jual", "beli", "punya", "ready", "stok", "tersedia", "kah", "ya", "yg",
  "berapaan", "brp", "info", "tentang", "soal", "rekomendasi", "rekomendasikan", "saran", "recommended",
  "paling", "yang", "nya", "the", "termurah", "termahal", "murah", "mahal", "terlaris", "laris",
  "bawah", "dibawah", "atas", "diatas", "maksimal", "budget", "kurang", "lebih", "rp", "ribu", "rb", "k",
  "produknya", "barangnya", "jualan", "jualannya", "katalog", "katalognya", "semua", "semuanya", "seluruh",
  "daftar", "list", "koleksi", "lengkap", "toko", "tokonya", "lapak", "kalian", "kamu", "anda", "aku", "saya",
  "wanita", "pria", "women", "men", "cewek", "cowok", "best", "seller", "populer", "terpopuler", "favorit", "jt", "juta", "dari", "punya", "apakah", "gimana"
]);

function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s) {
  return normalizeText(s).split(" ").filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function toNumber(v) {
  const n = Number(String(v || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// "50rb", "50k", "50.000", "50 ribu", "1,5jt" -> angka rupiah
function parseBudget(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?\b/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  const unit = m[2];
  if (unit === "jt" || unit === "juta") n *= 1e6;
  else if (unit === "rb" || unit === "ribu" || unit === "k") n *= 1e3;
  return n >= 100 ? n : null;
}

function formatRupiah(v) {
  const n = toNumber(v);
  if (!n) return v || "-";
  return "Rp" + n.toLocaleString("id-ID");
}

class RAGEngine {
  constructor(csvPath, options = {}) {
    this.csvPath = csvPath || path.join(process.cwd(), "data", "products.csv");
    this.topK = options.topK || Number(process.env.RAG_TOP_K || 8);
    this.products = [];
    this.loadData();
  }

  loadData() {
    try {
      const text = fs.readFileSync(this.csvPath, "utf-8");
      const { items } = csvToObjects(text);
      this.products = items
        .filter(p => p.nama)
        .map((p, i) => ({
          ...p,
          id: i + 1,
          _harga: toNumber(p.harga),
          _terjual: toNumber(p.terjual_angka || p.terjual),
          _nama: normalizeText(p.nama),
          _kategori: normalizeText(p.kategori),
          _tokens: new Set(tokenize(`${p.nama} ${p.kategori} ${p.deskripsi || ""}`))
        }));
    } catch (err) {
      console.error("[RAG] Gagal memuat CSV:", err.message);
      this.products = [];
    }
    return this.products;
  }

  categories() {
    const counts = {};
    for (const p of this.products) {
      const k = p.kategori || "Umum";
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }

  isAllProductsQuery(q) {
    return /\b(semua|seluruh|katalog|daftar|list|koleksi|apa\s*(aja|saja)\s*(produk|barang)?(nya)?|jual\s+apa|produk\s*(apa|nya)\s*(aja|saja)?)\b/.test(q);
  }

  search(query, k = this.topK) {
    const q = String(query || "").toLowerCase();
    if (!q.trim() || this.products.length === 0) return { items: [], mode: "empty" };

    const wantsCheap = /(termurah|paling murah|murah)/.test(q);
    const wantsExpensive = /(termahal|paling mahal)/.test(q);
    const wantsBest = /(terlaris|paling laris|best ?seller|populer|terpopuler|favorit)/.test(q);
    const budget = /(bawah|kurang dari|maks|maksimal|budget|<)/.test(q) ? parseBudget(q) : null;

    // produk terbaru = produk berlabel "Produk Baru" di Shopee
    const newOnes = this.products.filter(p => /produk baru/i.test(p.deskripsi || ""));
    const wantsNew = /(terbaru|produk baru|new arrival|koleksi baru)/.test(q) && newOnes.length > 0;

    // angka harga ("50rb", "100000", "30k") bukan kata kunci produk
    const tokens = tokenize(q).filter(t => !/^\d+(rb|k|jt|ribu|juta)?$/.test(t) && !(wantsNew && /^(terbaru|baru|new|arrival)$/.test(t)));
    let pool = this.products;
    if (wantsNew) {
      // "atasan terbaru" tapi produk baru tidak ada atasannya -> cari di semua produk
      const relevant = tokens.length === 0 || newOnes.some(p => tokens.some(t => p._tokens.has(t)));
      if (relevant) pool = newOnes;
    }
    if (budget) pool = pool.filter(p => p._harga && p._harga <= budget);

    // Skor relevansi kata kunci
    let scored = pool.map(p => {
      let score = 0;
      for (const t of tokens) {
        if (p._nama.includes(t)) score += 8;
        if (p._kategori.includes(t)) score += 5;
        if (p._tokens.has(t)) score += 2;
        // cocok sebagian (misal "kaos" vs "kaosnya")
        else if (t.length >= 4) for (const pt of p._tokens) { if (pt.startsWith(t) || t.startsWith(pt)) { score += 1; break; } }
      }
      return { p, score };
    });

    if (tokens.length > 0) scored = scored.filter(s => s.score > 0);

    // Urutan: relevansi dulu, lalu sesuai permintaan (murah/mahal/laris)
    const tiebreak = (a, b) => {
      if (wantsCheap) return a.p._harga - b.p._harga;
      if (wantsExpensive) return b.p._harga - a.p._harga;
      return b.p._terjual - a.p._terjual;
    };
    if (wantsCheap || wantsExpensive || wantsBest) {
      scored.sort((a, b) => tiebreak(a, b) || b.score - a.score);
    } else {
      scored.sort((a, b) => b.score - a.score || tiebreak(a, b));
    }

    let mode = "keyword";
    if (tokens.length === 0) {
      if (wantsCheap || wantsExpensive || wantsBest || budget || wantsNew) mode = "sorted";
      else if (this.isAllProductsQuery(q)) mode = "overview";
      else return { items: [], mode: "none" };
    }

    const limit = mode === "overview" ? Math.max(k, 10) : k;
    return { items: scored.slice(0, limit).map(s => s.p), mode, total: scored.length, budget };
  }

  formatProduct(p) {
    const parts = [`• ${p.nama}`, `  Harga: ${formatRupiah(p.harga)}`];
    if (p.harga_asli && toNumber(p.harga_asli) > toNumber(p.harga)) parts.push(`  Harga normal: ${formatRupiah(p.harga_asli)}`);
    if (p.diskon) parts.push(`  Diskon: ${p.diskon}`);
    if (p.kategori) parts.push(`  Kategori: ${p.kategori}`);
    if (p.terjual) parts.push(`  Terjual: ${p.terjual}`);
    if (p.rating) parts.push(`  Rating: ${p.rating}`);
    if (p.lokasi) parts.push(`  Dikirim dari: ${p.lokasi}`);
    if (p.deskripsi) parts.push(`  Deskripsi: ${p.deskripsi}`);
    if (p.link) parts.push(`  Link: ${p.link}`);
    return parts.join("\n");
  }

  buildContext(query) {
    const result = this.search(query);
    if (!result.items.length) return "";

    let out = `Ringkasan toko: ${this.products.length} produk. Kategori: ` +
      Object.entries(this.categories()).map(([k, v]) => `${k} (${v})`).join(", ") + ".\n";

    if (result.mode === "overview") {
      out += "\nPelanggan meminta gambaran umum katalog. Berikut produk terlaris sebagai contoh:\n";
    } else {
      out += `\nProduk yang relevan dengan pertanyaan (${result.items.length} dari ${result.total} hasil cocok`;
      if (result.budget) out += `, harga di bawah ${formatRupiah(result.budget)}`;
      out += "):\n";
    }
    out += result.items.map(p => this.formatProduct(p)).join("\n\n");
    return out;
  }
}

module.exports = { RAGEngine, formatRupiah, toNumber, normalizeText };
