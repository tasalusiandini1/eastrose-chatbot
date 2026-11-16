// Membersihkan CSV hasil Instant Data Scraper (Shopee) menjadi data/products.csv yang rapi.
//
// Pemakaian:
//   node scripts/clean-csv.js "C:\Users\kamu\Downloads\shopee.csv"
//
// Nama kolom hasil ekstensi biasanya acak (misal "line-clamp-2", "truncate", "_image_yazko_11 src"),
// jadi skrip ini MENEBAK isi setiap kolom dari pola datanya:
//   - contents href  -> link produk (wajib ada)
//   - URL gambar      -> gambar
//   - "1RB+ terjual"  -> terjual
//   - "-42%"          -> diskon
//   - "4.9"           -> rating
//   - "13.000"        -> harga
//   - teks panjang    -> nama produk (cadangan: diambil dari URL produk)
const fs = require("fs");
const path = require("path");
const { csvToObjects, objectsToCSV } = require("../lib/csv");

const ROOT = path.join(__dirname, "..");
const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error("❌ File CSV tidak ditemukan.\n   Contoh: node scripts/clean-csv.js \"C:\\Users\\kamu\\Downloads\\shopee.csv\"");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "store.config.json"), "utf-8"));
const raw = fs.readFileSync(input, "utf-8");
const { headers, items } = csvToObjects(raw);
console.log(`📄 Membaca ${items.length} baris, ${headers.length} kolom`);

// ---------- Deteksi jenis setiap kolom ----------
const isProductUrl = v => /shopee\.co\.id\/.+-i\.\d+\.\d+/.test(v) || /shopee\.co\.id\/product\/\d+\/\d+/.test(v);
const isImageUrl = v => /susercontent\.com|\/file\/|\.(jpe?g|png|webp)(\?|$)/i.test(v);
const isSold = v => /terjual|sold/i.test(v);
const isDiscount = v => /^-?\s?\d{1,2}\s?%$/.test(v);
const isRating = v => /^[0-5]([.,]\d)?$/.test(v);
const isPrice = v => /^(rp\s?)?\d{1,3}(\.\d{3})+(\s?-\s?(rp\s?)?\d{1,3}(\.\d{3})+)?$/i.test(v) || /^(rp\s?)?\d{4,}$/i.test(v);
const isLocation = v => /^(kab\.|kota|jakarta|luar negeri|kab |provinsi)/i.test(v);

function ratio(col, test) {
  const vals = items.map(it => it[col]).filter(v => v && v.trim());
  if (!vals.length) return { r: 0, vals };
  return { r: vals.filter(test).length / vals.length, vals };
}

const used = new Set();
function pick(test, minRatio = 0.6, prefer = () => 0) {
  let best = null;
  for (const h of headers) {
    if (used.has(h)) continue;
    const { r, vals } = ratio(h, test);
    if (r >= minRatio) {
      const score = r * vals.length + prefer(h, vals);
      if (!best || score > best.score) best = { h, score };
    }
  }
  if (best) used.add(best.h);
  return best ? best.h : null;
}

// "contents href" diprioritaskan sebagai link produk
const linkCol = headers.includes("contents href") && ratio("contents href", isProductUrl).r > 0.3
  ? (used.add("contents href"), "contents href")
  : pick(isProductUrl, 0.3);
if (!linkCol) {
  console.error("❌ Tidak menemukan kolom link produk (contents href). Ulangi scraping dan pilih tabel yang benar (\"Try another table\").");
  process.exit(1);
}
const imgCol = pick(isImageUrl, 0.5);
const soldCol = pick(isSold, 0.3);
const discCol = pick(isDiscount, 0.2);
const ratingCol = pick(isRating, 0.5);
const priceCol = pick(isPrice, 0.6);
// harga kedua (harga sebelum diskon), jika ada
const priceCol2 = pick(isPrice, 0.3);
const locCol = pick(isLocation, 0.5);
// keunggulan singkat produk (misal "Nyaman seharian!") -> dipakai sebagai deskripsi
const isBadge = v => /^(pilih lokal|produk baru|star\+?|mall|ori|termurah di shopee|cod)$/i.test(v);
const descCol = pick(v => v.length >= 4 && v.length <= 60 && /[a-z]/i.test(v) && !isSold(v) && !isPrice(v) && !isRating(v) && !isBadge(v) && !/^https?:/.test(v) && !/penilaian/i.test(v), 0.6);
const nameCol = pick(v => v.length > 15 && !/^https?:/.test(v) && !isPrice(v), 0.6, (h, vals) =>
  vals.reduce((s, v) => s + v.length, 0) / vals.length);

console.log("🔎 Kolom terdeteksi:");
console.table({ link: linkCol, nama: nameCol, harga: priceCol, harga_lain: priceCol2, diskon: discCol, terjual: soldCol, rating: ratingCol, lokasi: locCol, deskripsi: descCol, gambar: imgCol });

// ---------- Helper ----------
function nameFromUrl(url) {
  try {
    const p = decodeURIComponent(new URL(url).pathname.slice(1));
    return p.replace(/-i\.\d+\.\d+.*$/, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}
function cleanUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`; // buang parameter tracking (?sp_atk=..)
  } catch { return url; }
}
function itemKey(url) {
  const m = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/product\/(\d+)\/(\d+)/);
  return m ? `${m[1]}.${m[2]}` : url;
}
function firstPrice(v) {
  const m = String(v || "").match(/\d{1,3}(?:\.\d{3})+|\d{4,}/);
  return m ? Number(m[0].replace(/\./g, "")) : 0;
}
function soldNumber(v) {
  const m = String(v || "").toLowerCase().match(/([\d.,]+)\s*(rb|jt|k)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (m[2] === "rb" || m[2] === "k") n *= 1000;
  if (m[2] === "jt") n *= 1e6;
  return Math.round(n);
}
function categorize(name) {
  const rules = config.kategoriRules || {};
  // Cek dulu bagian utama nama (sebelum "|"), baru nama lengkap.
  // Contoh: "Shea Denim Top | ... Top Jeans Wanita" -> kategori dari "Shea Denim Top"
  const candidates = [name.split("|")[0], name].map(s => s.toLowerCase());
  for (const n of candidates) {
    for (const [kategori, words] of Object.entries(rules)) {
      if (words.some(w => new RegExp(`\\b${w.toLowerCase()}`).test(n))) return kategori;
    }
  }
  return "Umum";
}
// Kolom "terjual" kadang bergeser ke kolom lain -> cari di semua kolom baris itu
function findSold(it) {
  if (soldCol && it[soldCol] && isSold(it[soldCol])) return it[soldCol];
  return Object.values(it).find(v => v && isSold(v)) || "";
}

// ---------- Bangun data bersih ----------
const seen = new Set();
const products = [];
for (const it of items) {
  const link = it[linkCol];
  if (!link || !isProductUrl(link)) continue;
  const key = itemKey(link);
  if (seen.has(key)) continue; // hapus duplikat
  seen.add(key);

  let nama = (nameCol && it[nameCol]) || nameFromUrl(link);
  nama = nama.replace(/\s+/g, " ").trim();
  let harga = firstPrice(priceCol && it[priceCol]);
  let hargaLain = firstPrice(priceCol2 && it[priceCol2]);
  let hargaAsli = "";
  if (hargaLain && harga) {
    if (hargaLain > harga) hargaAsli = hargaLain;
    else if (hargaLain < harga) { hargaAsli = harga; harga = hargaLain; }
  } else if (!harga && hargaLain) harga = hargaLain;

  products.push({
    nama,
    kategori: categorize(nama),
    harga: harga || "",
    harga_asli: hargaAsli,
    diskon: discCol ? (it[discCol] || "").replace(/\s/g, "") : "",
    terjual: findSold(it),
    terjual_angka: soldNumber(findSold(it)) || "",
    rating: ratingCol && isRating(it[ratingCol] || "") ? it[ratingCol].replace(",", ".") : "",
    lokasi: locCol ? it[locCol] || "" : "",
    deskripsi: [Object.values(it).some(v => /^produk baru$/i.test(v)) ? "Produk baru (terbaru)" : "", descCol ? it[descCol] || "" : ""].filter(Boolean).join(". "),
    link: cleanUrl(link),
    gambar: imgCol ? it[imgCol] || "" : "",
    "contents href": link
  });
}

if (!products.length) {
  console.error("❌ Tidak ada produk valid. Pastikan CSV berasal dari tabel produk yang benar.");
  process.exit(1);
}

const outHeaders = ["nama", "kategori", "harga", "harga_asli", "diskon", "terjual", "terjual_angka", "rating", "lokasi", "deskripsi", "link", "gambar", "contents href"];
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "products.csv"), objectsToCSV(outHeaders, products));
fs.copyFileSync(input, path.join(ROOT, "data", "shopee-raw.csv")); // simpan file asli sebagai bukti scraping

const noPrice = products.filter(p => !p.harga).length;
console.log(`\n✅ ${products.length} produk unik disimpan ke data/products.csv (duplikat dibuang: ${items.length - products.length})`);
console.log("   File asli disalin ke data/shopee-raw.csv");
if (noPrice) console.log(`⚠️  ${noPrice} produk tanpa harga — cek kolom harga di CSV asli.`);
const cats = {};
products.forEach(p => { cats[p.kategori] = (cats[p.kategori] || 0) + 1; });
console.log("   Kategori:", cats);
console.log("\nContoh 3 produk pertama:");
console.table(products.slice(0, 3).map(p => ({ nama: p.nama.slice(0, 50), harga: p.harga, terjual: p.terjual, rating: p.rating })));
