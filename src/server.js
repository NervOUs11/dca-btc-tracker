const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure data/ folder + file ────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH  = path.join(DATA_DIR, "dca.json");

const TMP_PATH = DB_PATH + ".tmp";
const BAK_PATH = DB_PATH + ".bak";

const emptyDB = () => ({ entries: [], nextId: 1, priceCache: null });

if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); console.log("✅  Created data/"); }

// Treat a 0-byte file as missing: an interrupted write can leave one behind.
function isUsable(p) {
  try { return fs.readFileSync(p, "utf8").trim().length > 0; }
  catch { return false; }
}

if (!isUsable(DB_PATH)) {
  if (isUsable(BAK_PATH)) {
    fs.copyFileSync(BAK_PATH, DB_PATH);
    console.log("♻️   data/dca.json was empty — restored from dca.json.bak");
  } else {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDB(), null, 2));
    console.log("✅  Created data/dca.json");
  }
}

function readDB() {
  for (const p of [DB_PATH, BAK_PATH]) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      if (raw.trim()) return JSON.parse(raw);
      console.error(`⚠️   ${path.basename(p)} is empty`);
    } catch (e) {
      if (e.code !== "ENOENT") console.error(`⚠️   Cannot read ${path.basename(p)}: ${e.message}`);
    }
  }
  console.error("⚠️   No readable database — starting from empty");
  return emptyDB();
}

// Atomic: write a temp file, then rename over the real one. rename() is
// atomic, so a process killed mid-write (nodemon restart, Ctrl-C) leaves
// the previous file intact instead of truncating it to 0 bytes.
// `backup` refreshes dca.json.bak with the state being replaced. Only writes
// that change entries may do this: the price cache rewrites the file every
// few seconds, and letting it touch the backup overwrites the last good copy
// within seconds of any data loss — which is exactly how a backup gets lost.
function writeDB(d, { backup = true } = {}) {
  fs.writeFileSync(TMP_PATH, JSON.stringify(d, null, 2));
  if (backup) {
    try { if (isUsable(DB_PATH)) fs.copyFileSync(DB_PATH, BAK_PATH); } catch {}
  }
  fs.renameSync(TMP_PATH, DB_PATH);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Action helpers ────────────────────────────────────────────────────────────
// buy       → BTC increases, THB invested increases
// sell      → BTC decreases, THB invested decreases (proceeds returned)
// move_fee  → BTC decreases, no THB involved (network/withdraw fee paid in BTC)
const ACTIONS = ["buy", "sell", "move_fee"];

function normAction(raw) {
  const a = String(raw || "buy").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ACTIONS.includes(a) ? a : "buy";
}

// Signed BTC delta of an entry
function btcDelta(e) {
  const amt = parseFloat(e.btc_bought) || 0;
  return normAction(e.action) === "buy" ? amt : -amt;
}

// Signed THB invested of an entry (move_fee costs no THB)
function thbDelta(e) {
  const amt = parseFloat(e.thb_amount) || 0;
  const a   = normAction(e.action);
  if (a === "buy")  return amt;
  if (a === "sell") return -amt;
  return 0;
}

// Validate a payload for the given action. Returns an error string or null.
function validateEntry({ action, date, thb_amount, btc_price_thb, btc_bought }) {
  if (!date) return "Missing date";
  if (!btc_bought || parseFloat(btc_bought) <= 0) return "Missing BTC amount";
  if (action === "move_fee") return null;          // BTC amount is all we need
  if (!thb_amount || parseFloat(thb_amount) <= 0)       return "Missing THB amount";
  if (!btc_price_thb || parseFloat(btc_price_thb) <= 0) return "Missing BTC price";
  return null;
}

// ── Price cache ───────────────────────────────────────────────────────────────
// The client posts on every WebSocket tick — several times a second. Persist
// at most once per interval so the whole DB is not rewritten continuously;
// the cache is only a fallback for when no client is connected.
const PRICE_WRITE_MS = 10_000;
let lastPriceWrite   = 0;

app.post("/api/price-cache", (req, res) => {
  const { price } = req.body;
  if (!price || isNaN(price)) return res.status(400).json({ error: "Invalid price" });
  const now = Date.now();
  if (now - lastPriceWrite < PRICE_WRITE_MS) return res.json({ ok: true, throttled: true });
  lastPriceWrite = now;
  const db = readDB();
  db.priceCache = { price: parseFloat(price), updatedAt: new Date().toISOString() };
  writeDB(db, { backup: false });   // must never touch the backup — see writeDB
  res.json({ ok: true });
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
  const action = normAction(req.body.action);
  const err    = validateEntry({ action, date, thb_amount, btc_price_thb, btc_bought });
  if (err) return res.status(400).json({ error: err });
  const db    = readDB();
  const entry = {
    id: db.nextId++,
    date,
    action,
    input_mode:    input_mode || "thb",
    thb_amount:    parseFloat(thb_amount) || 0,
    fee_thb:       parseFloat(fee_thb) || 0,
    btc_price_thb: parseFloat(btc_price_thb) || 0,
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
  const action = normAction(req.body.action);
  const err    = validateEntry({ action, date, thb_amount, btc_price_thb, btc_bought });
  if (err) return res.status(400).json({ error: err });
  const db  = readDB();
  const idx = db.entries.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  db.entries[idx] = {
    ...db.entries[idx],
    date,
    action,
    input_mode:    input_mode || "thb",
    thb_amount:    parseFloat(thb_amount) || 0,
    fee_thb:       parseFloat(fee_thb) || 0,
    btc_price_thb: parseFloat(btc_price_thb) || 0,
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

  const of = act => entries.filter(e => normAction(e.action) === act);

  // Net position — sells and move fees subtract
  const totalTHB = entries.reduce((s, e) => s + thbDelta(e), 0);   // net invested
  const totalBTC = entries.reduce((s, e) => s + btcDelta(e), 0);   // net holdings
  const totalFee = entries.reduce((s, e) => s + (e.fee_thb || 0), 0);

  // Per-action breakdown
  const sumBTC = act => of(act).reduce((s, e) => s + (e.btc_bought || 0), 0);
  const sumTHB = act => of(act).reduce((s, e) => s + (e.thb_amount || 0), 0);

  const btcBought  = sumBTC("buy");
  const btcSold    = sumBTC("sell");
  const btcMoveFee = sumBTC("move_fee");
  const thbBuy     = sumTHB("buy");
  const thbSell    = sumTHB("sell");

  // Average price actually paid on buys. Deliberately gross: netting
  // sells out of it turns negative as soon as proceeds exceed what
  // was put in, which is meaningless as an "avg buy price".
  const avgBuyPrice     = btcBought > 0 ? thbBuy / btcBought : 0;
  const currentValueTHB = totalBTC * current;
  const pnlTHB          = currentValueTHB - totalTHB;
  const pnlPct          = totalTHB > 0 ? (pnlTHB / totalTHB) * 100 : 0;

  res.json({
    totalTHB, totalFee, totalBTC, avgBuyPrice,
    currentPrice: current, currentValueTHB, pnlTHB, pnlPct,
    entryCount: entries.length,
    btcBought, btcSold, btcMoveFee, thbBuy, thbSell,
    buyCount:      of("buy").length,
    sellCount:     of("sell").length,
    moveFeeCount:  of("move_fee").length,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀  DCA BTC Tracker  →  http://localhost:${PORT}`);
  console.log(`💾  Data:  ${DB_PATH}\n`);
});