# DCA ₿TC Tracker

> Dollar Cost Averaging tracker for Bitcoin — Thai Baht · Bitkub live prices · Cyberpunk UI

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Theme](https://img.shields.io/badge/theme-cyberpunk-ff00e5?style=flat-square)

---

## Features

- **Live BTC/THB price** via Bitkub WebSocket — real-time, auto-reconnects on disconnect
- **Three transaction types** — Buy, Sell, and Move Fee (network fee paid in BTC)
- **Two input modes** — enter a THB amount and let BTC be derived, or enter the exact BTC and let THB be derived
- **CSV import / export** — bring in your Bitkub trading history, with duplicate detection and a preview before anything is written
- **Dashboard summary** — net BTC held, net invested, average buy price, portfolio value, unrealized P&L
- **Stack Goal** — set a BTC target and get an ETA based on your monthly DCA budget
- **Retirement projection** — accumulation and withdrawal modelling with a Monte Carlo simulation
- **Crash-safe storage** — plain JSON file, atomic writes, automatic backup; no database to set up

---

## Getting Started

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/your-username/dca-btc-tracker.git
cd dca-btc-tracker
npm install
npm start
```

Open **http://localhost:3000**.

For development with auto-restart:

```bash
npm run dev
```

Set a different port with `PORT=4000 npm start`.

---

## Transaction Types

Every entry has an `action` that decides how it moves your balances.

| Action | BTC | THB invested | Fields required |
|---|---|---|---|
| **Buy** | increases | increases | date, amount, price |
| **Sell** | decreases | decreases | date, amount, price |
| **Move Fee** | decreases | unchanged | date, BTC amount only |

*Move Fee* is for the network/withdrawal fee an exchange charges in BTC when you move coins out. It costs you BTC without being a trade, so it lowers your holdings while leaving your invested THB untouched — which correctly raises your average cost per remaining coin.

Entries with no `action` (from an older version of this app) are treated as **Buy**.

---

## How Amounts Are Calculated

The fee is applied in opposite directions for a buy and a sell, because a buy fee comes out of the money you put in, while a sell fee comes out of the money you get back.

**THB mode** — you type an amount of Baht:

```
Buy    fee   = thb × fee%              ← thb is the cash you paid, fee included
       btc   = (thb − fee) ÷ price

Sell   gross = thb ÷ (1 − fee%)        ← thb is the cash you received, fee already deducted
       fee   = gross − thb
       btc   = gross ÷ price
```

The sell case divides rather than multiplying because the exchange charges its fee on the **gross** order value, so the gross has to be recovered from the net you actually received.

**BTC mode** — you type an exact BTC amount:

```
Buy    thb = btc × price + fee         ← cash out
Sell   thb = btc × price − fee         ← cash in
```

BTC amounts are truncated to 8 decimals (never rounded up), so a partial satoshi is dropped rather than invented.

### Dashboard maths

```
Net BTC        = bought − sold − move fees
Net invested   = THB from buys − THB from sells
Avg buy price  = THB from buys ÷ BTC bought        (buys only — never goes negative)
Unrealized P&L = (net BTC × live price) − net invested
```

Average buy price deliberately ignores sells. Netting them in would turn the figure negative as soon as your proceeds exceed what you put in, which is meaningless as an "average price paid".

---

## CSV Import

Click **⬆ IMPORT CSV** and drop a file. Nothing is written until you confirm on the preview screen.

Columns are matched **by header name**, so their order does not matter and extra columns are ignored. Both Thai and English headers are recognised:

| Field | Accepted headers |
|---|---|
| Date | `วันที่` `วันเวลา` `date` |
| Symbol | `ชื่อ` `สัญลักษณ์` `เหรียญ` `symbol` `coin` `pair` |
| Action | `Action` `ประเภท` `ชนิด` `รายการ` `side` `type` |
| THB | `ต้นทุน` `มูลค่า` `จำนวนเงิน` `THB SPENT` `total` |
| Price | `ราคา` `BTC PRICE` `price` |
| Fee | `ค่าธรรมเนียม` `fee` |
| BTC amount | `จำนวนหน่วย` `จำนวน` `BTC BOUGHT` `unit` `volume` |
| Note | `หมายเหตุ` `บันทึก` `รายละเอียด` `note` `memo` `remark` |

**Action values:** `Buy` / `ซื้อ`, `Sell` / `ขาย`, `Move Fee` / `ค่าธรรมเนียมการโอน`. Missing or unrecognised values default to Buy.

**Dates:** `28/มกราคม/2025` (Thai month), `28/01/2025`, or `2025-01-28`.

Other behaviour worth knowing:

- Only BTC rows are imported; other pairs are skipped silently
- A **Move Fee** row only needs a date and a BTC amount — empty or `-` in the THB, price and fee columns is fine
- Rows already in your history (same date + action + BTC amount) are flagged **DUPLICATE** and excluded
- The `note` column is carried through as-is; if the file has no note column the note is left empty
- Files with no header row fall back to the original Bitkub column order, with the action detected from whichever column contains it

**Export** produces a file with a summary block, then a full data table including the action — and it can be imported straight back in.

---

## Project Structure

```
dca-btc-tracker/
├── src/
│   └── server.js            # Express server + REST API + JSON storage
├── public/
│   ├── index.html           # App shell & UI markup
│   ├── style.css            # Cyberpunk theme
│   ├── retirement-style.css # Retirement tab + import modal styles
│   ├── app.js               # Tracker: WebSocket, forms, history, goal
│   ├── import.js            # CSV parsing, import preview, export
│   └── retirement.js        # Retirement projection & Monte Carlo
├── data/                    # Auto-created on first run
│   ├── dca.json             # Entries, price cache, goal
│   └── dca.json.bak         # Last known-good copy
├── package.json
└── README.md
```

> `data/` is in `.gitignore`, so your history is not committed. Remove that line if you want to version-control it.

---

## Data Safety

Your entire history lives in one file that is not in version control, so writes are handled defensively:

- **Atomic writes** — the server writes `dca.json.tmp` then renames it over `dca.json`. `rename()` is atomic, so a process killed mid-write (Ctrl-C, a dev-server restart) leaves the previous file intact instead of truncating it to zero bytes.
- **Backup** — `dca.json.bak` holds the state from before the last entry change. The price cache, which rewrites the file every few seconds, deliberately does *not* touch the backup — otherwise any data loss would be copied over the backup within seconds.
- **Recovery on start** — an empty or unreadable `dca.json` is restored from `dca.json.bak` automatically.
- **nodemon ignores `data/`** — otherwise every saved entry would restart the dev server mid-write. Configured under `nodemonConfig` in `package.json`; keep it if you change the dev script.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/entries` | All entries, newest first |
| `POST` | `/api/entries` | Add an entry |
| `PUT` | `/api/entries/:id` | Update an entry |
| `DELETE` | `/api/entries/:id` | Delete an entry |
| `GET` | `/api/summary` | Aggregated stats |
| `POST` | `/api/price-cache` | Browser pushes the latest Bitkub price (throttled to one write per 10s) |
| `GET` | `/api/goal` | Current stack goal |
| `POST` | `/api/goal` | Set or update the stack goal |
| `DELETE` | `/api/goal` | Remove the stack goal |

### Entry object

```json
{
  "id": 1,
  "date": "2025-01-15",
  "action": "buy",
  "input_mode": "thb",
  "thb_amount": 1000,
  "fee_thb": 2.5,
  "btc_price_thb": 3500000,
  "btc_bought": 0.00028500,
  "note": "monthly DCA",
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

`action` is `"buy"`, `"sell"` or `"move_fee"`. `input_mode` is `"thb"` or `"btc"` and only records which form was used, so the entry reopens on the right tab. `btc_bought` is always a positive magnitude — the direction comes from `action`.

For a `move_fee` entry, `thb_amount`, `fee_thb` and `btc_price_thb` are all `0`; only `btc_bought` matters.

### Summary response

```json
{
  "totalBTC": 0.00124825, "totalTHB": 2550, "totalFee": 53.7531,
  "avgBuyPrice": 2035029, "currentPrice": 2155986,
  "currentValueTHB": 2691, "pnlTHB": 141, "pnlPct": 5.5,
  "entryCount": 4,
  "btcBought": 0.00149875, "btcSold": 0.0002005, "btcMoveFee": 0.00005,
  "thbBuy": 3050, "thbSell": 500,
  "buyCount": 2, "sellCount": 1, "moveFeeCount": 1
}
```

---

## How the Price Feed Works

Bitkub's REST API blocks server-side requests, so the price comes in through the browser:

1. The **browser** connects to `wss://api.bitkub.com/websocket-api/market.ticker.thb_btc`
2. On each tick it posts the price to `POST /api/price-cache`
3. The backend uses that cached price for P&L and summary calculations

The server persists the cached price at most once every 10 seconds — the ticker fires several times a second, and rewriting the whole database that often is both wasteful and risky.

The socket reconnects with exponential backoff (2s → 4s → 8s, capped at 30s), and reconnects immediately when you return to the tab. The dot in the header shows the state: green (live), yellow (connecting/reconnecting), red (error).

---

## Stack Goal

Set a target BTC amount and an optional monthly DCA budget.

- The progress bar fills as your **net** BTC grows, so sells and move fees push it back down
- ETA = `remaining BTC ÷ (monthly THB ÷ current BTC price)`, recalculated on every price tick
- On completion the bar turns green and shows 🎉

---

## Retirement Projection

The **// RETIRE** tab projects your stack forward. It reads your current BTC and average buy price from the tracker, and estimates your monthly DCA from your actual entry history.

You set your current age, retirement age, life expectancy, monthly DCA (and an optional annual increase), an expected annual BTC return, and an inflation rate. It then produces:

- An **accumulation** curve up to retirement, and a **withdrawal** curve after it
- A **runway** — how long the stack lasts at your chosen withdrawal rate
- A **Monte Carlo** simulation giving the probability the money outlives you
- A **scenario table** comparing bear / base / bull annual returns

These are projections from assumptions you choose, not predictions or financial advice.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Storage | JSON file (no native deps, runs anywhere Node does) |
| Price feed | Bitkub WebSocket API |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Charts | Chart.js (CDN, retirement tab only) |
| Fonts | Orbitron, Share Tech Mono, Rajdhani (Google Fonts) |

> `axios` and `node-cron` are listed in `package.json` but are not imported anywhere — leftovers from an earlier design that can safely be removed.
