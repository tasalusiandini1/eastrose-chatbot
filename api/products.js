// Serverless function Vercel: GET /api/products
// Mengembalikan info toko + daftar produk hasil scraping (data/products.csv)
const { getProducts, store } = require("../lib/chatbot");

module.exports = (req, res) => {
  const { faq, kategoriRules, ...publicStore } = store;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
  res.end(JSON.stringify({ store: publicStore, products: getProducts() }));
};
