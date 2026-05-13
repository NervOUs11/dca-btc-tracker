# DCA ₿TC Tracker

> Dollar Cost Averaging tracker for Bitcoin — Thai Baht · Bitkub live prices · Cyberpunk UI

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Theme](https://img.shields.io/badge/theme-cyberpunk-ff00e5?style=flat-square)

---

## Features

- **Live BTC/THB price** via Bitkub WebSocket — updates in real-time, auto-reconnects on disconnect
- **Two input modes** when logging a buy:
  - **THB → BTC** — enter THB amount + fee % + price, BTC received is calculated
  - **BTC Amount** — enter exact BTC received + price + flat fee, THB spent is calculated
- **Dashboard summary** — total BTC, total invested, avg buy price, current portfolio value, unrealized P&L
- **Stack Goal** — set a BTC target, track progress with an animated bar, and get an ETA based on your monthly DCA amount
- **Edit & delete** any historical entry through a modal
- **Data persistence** — all entries and settings stored locally in `data/dca.json`
- **No database setup** — plain JSON file, zero native dependencies

---

## Getting Started

### Prerequisites

- Node.js 18+

### Install & Run

```bash
git clone https://github.com/your-username/dca-btc-tracker.git
cd dca-btc-tracker

npm install
npm start
```

Open **http://localhost:3000** in your browser.

For development with auto-restart:

```bash
npm run dev
```

---

## Project Structure

```
dca-btc-tracker/
├── src/
│   └── server.js        # Express server + REST API
├── public/
│   ├── index.html       # App shell & UI markup
│   ├── style.css        # Cyberpunk theme
│   └── app.js           # Frontend logic, WebSocket, forms, goal tracker
├── data/                # Auto-created on first run
│   └── dca.json         # Entries, price cache, goal setting
├── package.json
├── .gitignore
└── README.md
```

> `data/` is listed in `.gitignore` by default so your buy history is not committed. Remove it from `.gitignore` if you want to version-control your data.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/entries` | All DCA entries, newest first |
| `POST` | `/api/entries` | Add a new entry |
| `PUT` | `/api/entries/:id` | Update an existing entry |
| `DELETE` | `/api/entries/:id` | Delete an entry |
| `GET` | `/api/summary` | Aggregated stats (total BTC, P&L, etc.) |
| `POST` | `/api/price-cache` | Browser pushes latest Bitkub price to backend |
| `GET` | `/api/goal` | Get current stack goal |
| `POST` | `/api/goal` | Set or update stack goal |
| `DELETE` | `/api/goal` | Remove stack goal |

### Entry object

```json
{
  "id": 1,
  "date": "2025-01-15",
  "input_mode": "thb",
  "thb_amount": 1000,
  "fee_thb": 2.5,
  "btc_price_thb": 3500000,
  "btc_bought": 0.00027928,
  "note": "monthly DCA",
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

`input_mode` is `"thb"` (Mode 1) or `"btc"` (Mode 2).

---

## How the Price Feed Works

Bitkub's REST API blocks non-browser (server-side) requests. The workaround:

1. The **browser** connects directly to Bitkub's WebSocket: `wss://api.bitkub.com/websocket-api/market.ticker.thb_btc`
2. Every tick, the browser pushes the latest price to the backend via `POST /api/price-cache`
3. The backend uses this cached price for all P&L and summary calculations

The WebSocket reconnects automatically with exponential backoff (2s → 4s → 8s → capped at 30s). The live dot in the header shows connection state — green (live), yellow (reconnecting), red (error).

---

## Stack Goal

Set a target BTC amount and an optional monthly DCA budget in THB.

- Progress bar animates from 0% → 100% as you log entries
- ETA is calculated from: `remaining BTC ÷ (monthly THB ÷ current BTC price)`
- ETA updates live with every WebSocket price tick
- When complete, the bar turns green and shows 🎉

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, node-cron |
| Storage | JSON file (no native DB, works anywhere Node runs) |
| Price feed | Bitkub WebSocket API |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Fonts | Orbitron, Share Tech Mono, Rajdhani (Google Fonts) |