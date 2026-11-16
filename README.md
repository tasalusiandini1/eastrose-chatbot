# Tugas: Website Lapak Shopee + Chatbot RAG + Gateway WhatsApp

Project ini berisi:

| Bagian | Lokasi | Fungsi |
| :--- | :--- | :--- |
| Data produk | `data/products.csv` | Hasil scraping lapak Shopee (sudah dibersihkan) |
| Bukti scraping | `data/shopee-raw.csv` | File CSV asli dari Instant Data Scraper (ada kolom `contents href`) |
| Info toko | `store.config.json` | Nama lapak, link Shopee, nomor WA, FAQ, aturan kategori |
| Mesin RAG | `lib/rag.js` | Mencari produk relevan dari CSV (kata kunci, termurah, terlaris, budget) |
| Otak chatbot | `lib/chatbot.js` | Alur berlapis: sapaan → FAQ → RAG + Groq LLM |
| API Vercel | `api/chat.js`, `api/products.js` | Serverless function untuk website & gateway WA |
| Website | `public/` | Katalog produk + widget chat + tombol WhatsApp |
| Gateway WA | `wa-gateway/` | Meneruskan pesan WhatsApp ke API chatbot yang sama |

```
Pengunjung website ──► /api/chat (Vercel) ◄── wa-gateway (laptop) ◄── Pesan WhatsApp
                            │
                  lib/chatbot.js + lib/rag.js + data/products.csv + Groq
```

---

## 1. Masukkan data hasil scraping

1. Isi `store.config.json`:
   - `namaToko` — nama lapak
   - `shopeeUrl` — link lapak, misal `https://shopee.co.id/namatoko`
   - `whatsapp` — nomor WA bot (format `62…`, tanpa `+` dan tanpa `0` di depan)
   - `kategoriRules` (opsional) — pengelompokan produk berdasarkan kata di nama produk, contoh:
     ```json
     "kategoriRules": { "Kaos": ["kaos", "t-shirt"], "Celana": ["celana", "jeans"] }
     ```
2. Jalankan pembersih CSV (ganti path sesuai lokasi file hasil download):
   ```
   node scripts/clean-csv.js "C:\Users\NAMAKAMU\Downloads\shopee.csv"
   ```
   Hasilnya `data/products.csv` (bersih, tanpa duplikat) dan `data/shopee-raw.csv` (file asli).

## 2. Coba di laptop

```
npm install groq-sdk
copy .env.example .env      (Mac/Linux: cp .env.example .env)
```
Isi `GROQ_API_KEY` di `.env`, lalu:
```
npm run dev
```
Buka http://localhost:3000, lalu coba widget chat di pojok kanan bawah.

## 3. Deploy ke Vercel

1. Upload folder project ini ke repository GitHub baru (file `.env` otomatis tidak ikut karena ada di `.gitignore`).
2. Buka https://vercel.com, login dengan GitHub, lalu klik **Add New → Project** dan **Import** repository tadi.
3. Framework Preset: **Other**. Biarkan pengaturan build kosong.
4. Buka **Environment Variables**, lalu tambahkan:
   - `GROQ_API_KEY` = API key Groq kamu
   - `GROQ_MODEL` = `qwen/qwen3.8-27b` (opsional)
5. Klik **Deploy**, lalu buka URL publiknya (misal `https://nama-project.vercel.app`).

> Kalau mengubah `data/products.csv` atau kode, cukup push ulang ke GitHub. Vercel akan deploy ulang otomatis.

## 4. Jalankan gateway WhatsApp

```
cd wa-gateway
npm install whatsapp-web.js qrcode-terminal
copy .env.example .env
```
Edit `wa-gateway/.env`, lalu isi URL Vercel kamu:
```
CHATBOT_API_URL=https://nama-project.vercel.app/api/chat
```
Jalankan:
```
npm start
```
Buka http://localhost:3002, lalu scan QR dari WhatsApp (**Perangkat tertaut → Tautkan perangkat**). Gunakan **nomor cadangan**.
Gateway harus tetap menyala selama pengujian.

## 5. Skenario uji untuk laporan

| Pesan | Lapisan | Hasil yang diharapkan |
| :--- | :--- | :--- |
| `halo` | Template | Salam pembuka, tanpa AI |
| `cara order gimana?` | FAQ | Langkah pemesanan + kontak |
| `apa aja produknya?` | RAG + LLM | Gambaran katalog & produk terlaris |
| `ada <nama produk>?` | RAG + LLM | Produk yang cocok + harga + link Shopee |
| `berapa harganya?` (lanjutan) | RAG + riwayat | Bot paham produk yang dibahas sebelumnya |
| `produk termurah apa?` | RAG (urut harga) | Produk dengan harga terendah |
| `ada yang di bawah 50rb?` | RAG (filter budget) | Produk di bawah Rp50.000 |
| `jual laptop?` (tidak ada di toko) | RAG + LLM | Bot bilang tidak tersedia, tidak mengarang |
| `makasih` | Template | Ucapan penutup |

Cocokkan jawaban bot dengan produk di lapak Shopee, karena dosen akan memverifikasi dengan cara yang sama.
