const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure data/ folder + file ────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH  = path.join(DATA_DIR, "dca.json");

if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); console.log("✅  Created data/"); }
if (!fs.existsSync(DB_PATH))  { fs.writeFileSync(DB_PATH, JSON.stringify({ entries: [], nextId: 1, priceCache: null }, null, 2)); console.log("✅  Created data/dca.json"); }

function readDB()    { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
function writeDB(d)  { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Price cache ───────────────────────────────────────────────────────────────
app.post("/api/price-cache", (req, res) => {
  const { price } = req.body;
  if (!price || isNaN(price)) return res.status(400).json({ error: "Invalid price" });
  const db = readDB();
  db.priceCache = { price: parseFloat(price), updatedAt: new Date().toISOString() };
  writeDB(db); res.json({ ok: true });
});

// ── Entries CRUD ──────────────────────────────────────────────────────────────
app.get("/api/entries", (req, res) => {
  const db = readDB();
  res.json([...db.entries].sort((a, b) =>
    b.date !== a.date ? b.date.localeCompare(a.date) : b.id - a.id
  ));
});

app.post("/api/entries", (req, res) => {
  const { date, thb_amount, fee_thb, btc_price_thb, btc_bought, input_mode, note } = req.body;
  if (!date || !thb_amount || !btc_price_thb || !btc_bought)
    return res.status(400).json({ error: "Missing required fields" });
  const db    = readDB();
  const entry = {
    id: db.nextId++,
    date,
    input_mode:    input_mode || "thb",
    thb_amount:    parseFloat(thb_amount),
    fee_thb:       parseFloat(fee_thb) || 0,
    btc_price_thb: parseFloat(btc_price_thb),
    btc_bought:    parseFloat(btc_bought),
    note:          note || "",
    created_at:    new Date().toISOString(),
  };
  db.entries.push(entry); writeDB(db);
  res.status(201).json(entry);
});

app.put("/api/entries/:id", (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const { date, thb_amount, fee_thb, btc_price_thb, btc_bought, input_mode, note } = req.body;
  if (!date || !thb_amount || !btc_price_thb || !btc_bought)
    return res.status(400).json({ error: "Missing required fields" });
  const db  = readDB();
  const idx = db.entries.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  db.entries[idx] = {
    ...db.entries[idx],
    date,
    input_mode:    input_mode || "thb",
    thb_amount:    parseFloat(thb_amount),
    fee_thb:       parseFloat(fee_thb) || 0,
    btc_price_thb: parseFloat(btc_price_thb),
    btc_bought:    parseFloat(btc_bought),
    note:          note || "",
    updated_at:    new Date().toISOString(),
  };
  writeDB(db); res.json(db.entries[idx]);
});

app.delete("/api/entries/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = readDB();
  db.entries = db.entries.filter(e => e.id !== id);
  writeDB(db); res.json({ success: true });
});

// ── Stack Goal ────────────────────────────────────────────────────────────────
app.get("/api/goal", (req, res) => {
  const db = readDB();
  res.json(db.goal || null);
});

app.post("/api/goal", (req, res) => {
  const { target_btc, monthly_thb } = req.body;
  if (!target_btc || target_btc <= 0)
    return res.status(400).json({ error: "Invalid target" });
  const db = readDB();
  db.goal = { target_btc: parseFloat(target_btc), monthly_thb: parseFloat(monthly_thb) || 0 };
  writeDB(db); res.json(db.goal);
});

app.delete("/api/goal", (req, res) => {
  const db = readDB();
  db.goal = null; writeDB(db); res.json({ ok: true });
});

// ── Summary ───────────────────────────────────────────────────────────────────
app.get("/api/summary", (req, res) => {
  const db      = readDB();
  const entries = db.entries;
  const current = db.priceCache?.price || 0;

  const totalTHB        = entries.reduce((s, e) => s + e.thb_amount, 0);
  const totalFee        = entries.reduce((s, e) => s + (e.fee_thb || 0), 0);
  const totalBTC        = entries.reduce((s, e) => s + e.btc_bought, 0);
  const avgBuyPrice     = totalBTC > 0 ? totalTHB / totalBTC : 0;
  const currentValueTHB = totalBTC * current;
  const pnlTHB          = currentValueTHB - totalTHB;
  const pnlPct          = totalTHB > 0 ? (pnlTHB / totalTHB) * 100 : 0;

  res.json({ totalTHB, totalFee, totalBTC, avgBuyPrice, currentPrice: current, currentValueTHB, pnlTHB, pnlPct, entryCount: entries.length });
});

app.listen(PORT, () => {
  console.log(`\n🚀  DCA BTC Tracker  →  http://localhost:${PORT}`);
  console.log(`💾  Data:  ${DB_PATH}\n`);
});