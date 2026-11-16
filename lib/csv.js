// Parser & writer CSV sederhana yang mendukung tanda kutip ("...") dan koma di dalam teks.
// Nama produk Shopee sering mengandung koma, jadi split(",") biasa tidak cukup.

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  text = text.replace(/^﻿/, ""); // hapus BOM

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

// Ubah CSV menjadi array objek { header: nilai }
function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { headers: rows[0] || [], items: [] };
  const headers = rows[0].map(h => h.trim());
  const items = rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
  return { headers, items };
}

function escapeCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function objectsToCSV(headers, items) {
  const lines = [headers.map(escapeCell).join(",")];
  for (const it of items) lines.push(headers.map(h => escapeCell(it[h])).join(","));
  return lines.join("\n") + "\n";
}

module.exports = { parseCSV, csvToObjects, objectsToCSV };
