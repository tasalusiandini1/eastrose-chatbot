// ================== Katalog Produk ==================
const PAGE_SIZE = 24;
let STORE = {};
let PRODUCTS = [];
let state = { q: "", cat: "Semua", sort: "default", shown: PAGE_SIZE };

const $ = id => document.getElementById(id);
const rupiah = n => n ? "Rp" + Number(n).toLocaleString("id-ID") : "-";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Template pesan WhatsApp per kategori (dibuka lewat https://wa.me/<nomor>?text=...)
function waLink(text) {
  return `https://wa.me/${STORE.whatsapp}?text=${encodeURIComponent(text)}`;
}
function waTemplate(p) {
  const kategori = p.kategori && p.kategori !== "Umum" ? ` (kategori ${p.kategori})` : "";
  return `Halo ${STORE.namaToko}, saya tertarik dengan produk:\n\n*${p.nama}*${kategori}\nHarga: ${rupiah(p.harga_angka)}\nLink: ${p.link}\n\nApakah produk ini masih tersedia?`;
}

async function loadCatalog() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    STORE = data.store || {};
    PRODUCTS = data.products || [];
    renderStore();
    renderChips();
    renderGrid();
  } catch (err) {
    $("productGrid").innerHTML = `<p class="empty">Gagal memuat produk. Coba muat ulang halaman.</p>`;
    console.error(err);
  }
}

function renderStore() {
  document.title = `${STORE.namaToko} — Katalog & Asisten AI`;
  $("storeName").textContent = STORE.namaToko;
  $("chatTitle").textContent = `Asisten ${STORE.namaToko}`;
  $("storeDesc").textContent = STORE.deskripsi || `Katalog produk ${STORE.namaToko} dari Shopee. Tanya apa saja ke asisten AI — jawabannya diambil langsung dari data produk toko.`;
  $("shopeeLink").href = STORE.shopeeUrl;
  $("footerShopee").href = STORE.shopeeUrl;
  $("waLink").href = waLink(`Halo ${STORE.namaToko}, saya mau tanya-tanya produk 😊`);

  const cats = new Set(PRODUCTS.map(p => p.kategori || "Umum"));
  const prices = PRODUCTS.map(p => p.harga_angka).filter(Boolean);
  $("statProducts").textContent = PRODUCTS.length.toLocaleString("id-ID");
  $("statCategories").textContent = cats.size;
  $("statMinPrice").textContent = prices.length ? rupiah(Math.min(...prices)) : "-";
}

function renderChips() {
  const counts = {};
  PRODUCTS.forEach(p => { const k = p.kategori || "Umum"; counts[k] = (counts[k] || 0) + 1; });
  const cats = ["Semua", ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  if (cats.length <= 2) { $("categoryChips").innerHTML = ""; return; }
  $("categoryChips").innerHTML = cats.map(c =>
    `<button class="chip" role="tab" aria-selected="${c === state.cat}" data-cat="${esc(c)}">${esc(c)}${c !== "Semua" ? ` · ${counts[c]}` : ""}</button>`
  ).join("");
}

function filtered() {
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = PRODUCTS.filter(p =>
    (state.cat === "Semua" || (p.kategori || "Umum") === state.cat) &&
    words.every(w => `${p.nama} ${p.kategori}`.toLowerCase().includes(w))
  );
  const by = {
    laris: (a, b) => (b.terjual_angka || 0) - (a.terjual_angka || 0),
    murah: (a, b) => (a.harga_angka || Infinity) - (b.harga_angka || Infinity),
    mahal: (a, b) => (b.harga_angka || 0) - (a.harga_angka || 0)
  }[state.sort];
  return by ? [...list].sort(by) : list;
}

function cardHTML(p) {
  const img = p.gambar
    ? `<img src="${esc(p.gambar)}" alt="${esc(p.nama)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  const old = p.harga_asli && Number(String(p.harga_asli).replace(/\D/g, "")) > p.harga_angka
    ? `<span class="card-old">${rupiah(String(p.harga_asli).replace(/\D/g, ""))}</span>` : "";
  const meta = [p.rating && `★ ${esc(p.rating)}`, p.terjual && esc(p.terjual), p.lokasi && esc(p.lokasi)].filter(Boolean);
  return `
    <article class="card">
      <a class="card-img" href="${esc(p.link)}" target="_blank" rel="noopener">${img}${p.diskon ? `<span class="badge">${esc(p.diskon)}</span>` : ""}</a>
      <div class="card-body">
        ${p.kategori && p.kategori !== "Umum" ? `<span class="card-cat">${esc(p.kategori)}</span>` : ""}
        <h3 class="card-name" title="${esc(p.nama)}">${esc(p.nama)}</h3>
        <div class="card-price">${rupiah(p.harga_angka)}${old}</div>
        ${meta.length ? `<div class="card-meta">${meta.map(m => `<span>${m}</span>`).join("")}</div>` : ""}
        <div class="card-actions">
          <a class="btn btn-ghost" href="${esc(p.link)}" target="_blank" rel="noopener">Shopee</a>
          <a class="btn btn-wa" href="${esc(waLink(waTemplate(p)))}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const list = filtered();
  const page = list.slice(0, state.shown);
  $("productGrid").innerHTML = page.length ? page.map(cardHTML).join("") : `<p class="empty">Produk tidak ditemukan. Coba kata kunci lain atau tanya asisten AI.</p>`;
  $("resultInfo").textContent = `Menampilkan ${page.length} dari ${list.length} produk`;
  $("loadMore").classList.toggle("hidden", list.length <= state.shown);
}

$("searchInput").addEventListener("input", e => { state.q = e.target.value; state.shown = PAGE_SIZE; renderGrid(); });
$("sortSelect").addEventListener("change", e => { state.sort = e.target.value; renderGrid(); });
$("loadMore").addEventListener("click", () => { state.shown += PAGE_SIZE; renderGrid(); });
$("categoryChips").addEventListener("click", e => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  state.cat = btn.dataset.cat; state.shown = PAGE_SIZE;
  renderChips(); renderGrid();
});

// ================== Widget Chatbot RAG ==================
const chatHistory = []; // riwayat percakapan dikirim ke /api/chat agar bot paham pertanyaan lanjutan
const panel = $("chatPanel");
const messagesEl = $("chatMessages");
let greeted = false;

function formatMessage(text) {
  let html = esc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:]|$)/gm, "$1<strong>$2</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[^"'>])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return html;
}

function addMessage(role, text, source) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = formatMessage(text);
  if (source) {
    const label = { template: "Template otomatis", faq: "FAQ toko", ai: "AI + data katalog (RAG)", fallback: "Data katalog" }[source];
    if (label) div.insertAdjacentHTML("beforeend", `<span class="msg-source">${label}</span>`);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function openChat() {
  panel.classList.remove("hidden");
  if (!greeted) {
    addMessage("bot", `Halo! 👋 Saya asisten ${STORE.namaToko || "toko"}. Mau cari produk apa hari ini?`);
    greeted = true;
  }
  $("chatInput").focus();
}

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;
  $("chatSuggestions").classList.add("hidden");
  addMessage("user", text);
  $("chatInput").value = "";
  const typing = addMessage("bot", "Sedang mengetik…");
  typing.classList.add("typing");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-6), channel: "web" })
    });
    const data = await res.json();
    typing.remove();
    const reply = data.reply || data.error || "Maaf, terjadi kesalahan.";
    addMessage("bot", reply, data.source);
    chatHistory.push({ role: "user", content: text }, { role: "assistant", content: reply });
  } catch (err) {
    typing.remove();
    addMessage("bot", "Maaf, koneksi ke server sedang bermasalah. Coba lagi sebentar.");
  }
}

$("chatToggle").addEventListener("click", () => panel.classList.contains("hidden") ? openChat() : panel.classList.add("hidden"));
$("openChatHero").addEventListener("click", openChat);
$("chatClose").addEventListener("click", () => panel.classList.add("hidden"));
$("chatForm").addEventListener("submit", e => { e.preventDefault(); sendMessage($("chatInput").value); });
$("chatSuggestions").addEventListener("click", e => { if (e.target.tagName === "BUTTON") sendMessage(e.target.textContent); });

loadCatalog();
