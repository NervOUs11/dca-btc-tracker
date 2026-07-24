/* ================================================================
   CSV IMPORT — public/import.js
   Parses Bitkub trading history CSV (Thai format) and posts
   each valid BTC row to POST /api/entries.

   Supports an ACTION column with three values:
     Buy       → BTC increases
     Sell      → BTC decreases
     Move Fee  → BTC decreases (BTC amount only, no THB / price)
   ================================================================ */

/* ── Thai month name → month number ─────────────────────────── */
const THAI_MONTHS = {
  'มกราคม':   '01', 'กุมภาพันธ์': '02', 'มีนาคม':    '03',
  'เมษายน':   '04', 'พฤษภาคม':    '05', 'มิถุนายน':   '06',
  'กรกฎาคม':  '07', 'สิงหาคม':    '08', 'กันยายน':    '09',
  'ตุลาคม':   '10', 'พฤศจิกายน':  '11', 'ธันวาคม':    '12',
};

/* ── Action labels for display ──────────────────────────────── */
const ACTION_LABEL = { buy: 'BUY', sell: 'SELL', move_fee: 'MOVE FEE' };

/* ── Raw action text → canonical action ─────────────────────── */
/* move_fee is tested first: its aliases are the most specific.  */
const ACTION_ALIASES = [
  ['move_fee', ['move fee', 'movefee', 'move_fee', 'transfer fee', 'withdraw fee',
                'withdrawal fee', 'network fee', 'ค่าธรรมเนียมการโอน', 'ค่าธรรมเนียมโอน', 'ค่าโอน']],
  ['buy',      ['buy', 'bought', 'ซื้อ']],
  ['sell',     ['sell', 'sold', 'ขาย']],
];

function parseAction(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  for (const [action, aliases] of ACTION_ALIASES) {
    if (aliases.some(a => v === a || v.includes(a))) return action;
  }
  return null;
}

/* ── Header text → field, in match priority order ───────────── */
/* THB aliases are tested before BTC so "จำนวนเงิน" is not
   swallowed by the "จำนวน" prefix of the BTC column.           */
const HEADER_ALIASES = [
  ['action', ['action', 'ประเภท', 'ชนิด', 'รายการ', 'side', 'type']],
  ['date',   ['วันที่', 'วันเวลา', 'date']],
  ['name',   ['ชื่อ', 'สัญลักษณ์', 'เหรียญ', 'คู่เหรียญ', 'symbol', 'coin', 'pair', 'market']],
  ['note',   ['หมายเหตุ', 'บันทึก', 'รายละเอียด', 'คำอธิบาย', 'note', 'memo', 'remark', 'comment', 'description']],
  ['fee',    ['ค่าธรรมเนียม', 'fee']],
  ['price',  ['ราคา', 'btc price', 'price']],
  ['thb',    ['ต้นทุน', 'มูลค่า', 'จำนวนเงิน', 'ยอดเงิน', 'thb spent', 'total', 'thb']],
  ['btc',    ['จำนวนหน่วย', 'จำนวน', 'ปริมาณ', 'btc bought', 'unit', 'volume', 'amount']],
];

const normHeader = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Map a header row to { field: columnIndex }, or null if the
   line does not look like a header at all.                     */
function mapHeader(cols) {
  const map    = {};
  const taken  = new Set();

  for (const [field, aliases] of HEADER_ALIASES) {
    for (let i = 0; i < cols.length; i++) {
      if (taken.has(i)) continue;
      const h = normHeader(cols[i]);
      if (!h) continue;
      if (aliases.some(a => h === a || h.startsWith(a))) {
        map[field] = i;
        taken.add(i);
        break;
      }
    }
  }

  // needs to look convincingly like a header, not a data row
  return Object.keys(map).length >= 3 ? map : null;
}

/* Default Bitkub layout when the file has no header row */
const LEGACY_MAP = { date: 0, name: 1, thb: 2, price: 3, fee: 4, btc: 5 };

/* ── Parse Thai / ISO / numeric date → "YYYY-MM-DD" ─────────── */
function parseThaiDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().split(' ')[0];   // drop any time part

  // ISO — 2025-01-28
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [day, monthRaw, year] = parts.map(p => p.trim());

  // Thai month name — 28/มกราคม/2025
  let month = THAI_MONTHS[monthRaw];

  // Numeric — 28/01/2025
  if (!month && /^\d{1,2}$/.test(monthRaw)) {
    const m = parseInt(monthRaw, 10);
    if (m >= 1 && m <= 12) month = String(m).padStart(2, '0');
  }
  if (!month) return null;

  return `${year}-${month}-${day.padStart(2, '0')}`;
}

/* ── Strip commas and parse float ────────────────────────────── */
function parseNum(raw) {
  if (!raw || String(raw).trim() === '-' || String(raw).trim() === '') return 0;
  return parseFloat(String(raw).replace(/,/g, '').trim()) || 0;
}

/* ── Parse entire CSV text → array of row objects ───────────── */
function parseCsv(text) {
  const lines   = text.split('\n').map(l => l.trimEnd());
  const valid   = [];
  const skipped = [];

  // Locate the header row first, so anything above it (export
  // titles, summary blocks) is ignored rather than mis-parsed.
  let colMap     = null;
  let firstDataI = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const header = mapHeader(splitCsvLine(lines[i]));
    if (header) { colMap = header; firstDataI = i + 1; break; }
  }

  for (const line of lines.slice(firstDataI)) {
    if (!line.trim()) continue;

    // split by comma — but quoted fields may contain commas
    let cols = splitCsvLine(line);

    let map = colMap;

    // No header: fall back to the legacy layout, pulling the
    // action out of whichever column happens to hold it.
    let actionFromScan = null;
    if (!map) {
      const actionIdx = cols.findIndex(c => parseAction(c));
      if (actionIdx !== -1) {
        actionFromScan = parseAction(cols[actionIdx]);
        cols = cols.filter((_, i) => i !== actionIdx);
      }
      map = LEGACY_MAP;
    }

    const at      = field => (map[field] !== undefined ? cols[map[field]] : '');
    const dateRaw = String(at('date') || '').trim();
    const name    = String(at('name') || '').trim();
    const note    = String(at('note') || '').trim();
    const action  = parseAction(at('action')) || actionFromScan || 'buy';

    const date  = parseThaiDate(dateRaw);
    const thb   = parseNum(at('thb'));
    const price = parseNum(at('price'));
    const fee   = parseNum(at('fee'));
    const btc   = parseNum(at('btc'));

    // Only BTC rows. An empty name column means "no filter available".
    if (name && !/btc/i.test(name)) continue;

    // Lines with neither a date nor an action are titles / summary
    // blocks / stray text — ignore them instead of counting as skipped.
    const looksLikeData = !!date || !!parseAction(at('action')) || !!actionFromScan;
    if (!looksLikeData) continue;

    const reason = rowError({ date, action, thb, price, btc });
    if (reason) { skipped.push({ raw: line, reason }); continue; }

    valid.push({
      date,
      action,
      thb_amount:    action === 'move_fee' ? 0 : thb,
      btc_price_thb: action === 'move_fee' ? 0 : price,
      fee_thb:       action === 'move_fee' ? 0 : fee,
      btc_bought:    btc,
      // taken straight from the file; empty when the file has no note column
      note,
    });
  }

  return { valid, skipped };
}

/* ── Per-action validation → error string or null ───────────── */
function rowError({ date, action, thb, price, btc }) {
  if (!date)    return 'Invalid date';
  if (btc <= 0) return 'Missing BTC amount';
  // a move fee is charged in BTC only — no THB, no price
  if (action === 'move_fee') return null;
  if (thb <= 0)   return 'Missing THB amount';
  if (price <= 0) return 'Missing BTC price';
  return null;
}

/* ── CSV line splitter — handles quoted commas ───────────────── */
function splitCsvLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/* ── State ───────────────────────────────────────────────────── */
let _importRows    = [];   // validated rows ready to import
let _existingDates = [];   // dates already in the tracker (for dupe detection)

/* ── Modal open/close ────────────────────────────────────────── */
function openImportModal() {
  resetImportModal();
  document.getElementById('importModalOverlay').classList.add('open');

  // fetch existing entries to detect duplicates
  fetch('/api/entries')
    .then(r => r.json())
    .then(entries => {
      _existingDates = entries.map(dupeKey);
    })
    .catch(() => { _existingDates = []; });
}

function closeImportModal() {
  document.getElementById('importModalOverlay').classList.remove('open');
  resetImportModal();
  // refresh the history table in the main app
  if (typeof loadEntries === 'function') loadEntries();
}

function resetImportModal() {
  _importRows = [];
  showImportStep(1);
  document.getElementById('importDropZone').classList.remove('drag-over');
  // reset file input
  const fileInput = document.querySelector('#importModalOverlay input[type=file]');
  if (fileInput) fileInput.value = '';
}

function showImportStep(n) {
  document.getElementById('importStep1').style.display = n === 1 ? '' : 'none';
  document.getElementById('importStep2').style.display = n === 2 ? '' : 'none';
  document.getElementById('importStep3').style.display = n === 3 ? '' : 'none';
}

/* ── File drop / file input ──────────────────────────────────── */
function handleImportDrop(e) {
  e.preventDefault();
  document.getElementById('importDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readCsvFile(file);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (file) readCsvFile(file);
}

function readCsvFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('Please select a .csv file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => processCSV(e.target.result);
  reader.readAsText(file, 'UTF-8');
}

/* ── Escape file text before it reaches innerHTML ───────────── */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Duplicate key — same day, same action, same BTC ────────── */
function dupeKey(e) {
  return `${e.date}_${e.action || 'buy'}_${Number(e.btc_bought).toFixed(8)}`;
}

/* ── Process CSV text → preview ─────────────────────────────── */
function processCSV(text) {
  const { valid, skipped } = parseCsv(text);

  // mark duplicates
  let dupeCount = 0;
  const rows = valid.map(row => {
    const isDupe = _existingDates.includes(dupeKey(row));
    if (isDupe) dupeCount++;
    return { ...row, isDupe };
  });

  _importRows = rows;

  // update summary counters
  document.getElementById('importCountValid').textContent   = rows.length;
  document.getElementById('importCountSkipped').textContent = skipped.length;
  document.getElementById('importCountDupe').textContent    = dupeCount;

  // build preview table
  const tbody = document.getElementById('importPreviewBody');
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (row.isDupe) tr.classList.add('import-dupe');
    const isFee = row.action === 'move_fee';
    const sign  = row.action === 'buy' ? '+' : '−';
    tr.innerHTML = `
      <td>${row.date}</td>
      <td><span class="action-badge action-${row.action}">${ACTION_LABEL[row.action]}</span></td>
      <td>${isFee ? '—' : '฿' + row.thb_amount.toLocaleString('th-TH')}</td>
      <td>${isFee ? '—' : '฿' + row.fee_thb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
      <td>${isFee ? '—' : '฿' + row.btc_price_thb.toLocaleString('th-TH')}</td>
      <td class="import-btc-${row.action === 'buy' ? 'in' : 'out'}">${sign}${row.btc_bought.toFixed(8)}</td>
      <td class="import-note" title="${escHtml(row.note)}">${escHtml(row.note) || '—'}</td>
      <td>
        ${row.isDupe
          ? '<span class="import-badge import-badge--dupe">DUPLICATE</span>'
          : '<span class="import-badge import-badge--new">NEW</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // update button label to show how many new rows
  const newCount = rows.filter(r => !r.isDupe).length;
  document.getElementById('btnConfirmImport').innerHTML =
    `<span class="btn-icon">⬆</span> IMPORT ${newCount} NEW`;

  showImportStep(2);
}

/* ── Confirm and POST to API ─────────────────────────────────── */
async function confirmImport() {
  const toImport = _importRows.filter(r => !r.isDupe);
  if (toImport.length === 0) {
    alert('No new entries to import — all rows are duplicates.');
    return;
  }

  const btn = document.getElementById('btnConfirmImport');
  btn.disabled    = true;
  btn.textContent = 'IMPORTING…';

  let successCount = 0;
  let failCount    = 0;

  for (const row of toImport) {
    try {
      const res = await fetch('/api/entries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          date:          row.date,
          action:        row.action,
          thb_amount:    row.thb_amount,
          fee_thb:       row.fee_thb,
          btc_price_thb: row.btc_price_thb,
          btc_bought:    row.btc_bought,
          input_mode:    row.action === 'move_fee' ? 'btc' : 'thb',
          note:          row.note || '',
        }),
      });
      if (res.ok) successCount++;
      else        failCount++;
    } catch {
      failCount++;
    }
  }

  btn.disabled = false;

  // show done step
  document.getElementById('importDoneMsg').textContent =
    `${successCount} entr${successCount === 1 ? 'y' : 'ies'} imported successfully` +
    (failCount > 0 ? `, ${failCount} failed.` : '.');
  showImportStep(3);
}

/* ================================================================
   CSV EXPORT
   Fetches all entries from /api/entries and triggers a download.
   ================================================================ */

async function exportCSV() {
  let entries, summary;

  try {
    const [entriesRes, summaryRes] = await Promise.all([
      fetch('/api/entries'),
      fetch('/api/summary'),
    ]);
    entries = await entriesRes.json();
    summary = await summaryRes.json();
  } catch (e) {
    alert('Failed to fetch data for export.');
    return;
  }

  if (!entries || entries.length === 0) {
    alert('No entries to export.');
    return;
  }

  // ── build CSV rows ───────────────────────────────────────────
  const rows = [];

  // title
  rows.push(['DCA BTC TRACKER — Export']);

  // summary block
  rows.push([]);
  rows.push(['SUMMARY']);
  rows.push(['Net BTC',         (summary.totalBTC || 0).toFixed(8),                       'BTC']);
  rows.push(['BTC Bought',      (summary.btcBought || 0).toFixed(8),                      'BTC']);
  rows.push(['BTC Sold',        (summary.btcSold || 0).toFixed(8),                        'BTC']);
  rows.push(['BTC Move Fees',   (summary.btcMoveFee || 0).toFixed(8),                     'BTC']);
  rows.push(['Net Invested',    summary.totalTHB.toLocaleString('th-TH'),                 'THB']);
  rows.push(['Avg Buy Price',   Math.round(summary.avgBuyPrice).toLocaleString('th-TH'),  'THB/BTC']);
  rows.push(['Total Entries',   entries.length]);
  rows.push(['Exported At',     new Date().toLocaleString('th-TH')]);
  rows.push([]);

  // column headers
  rows.push(['DATE', 'ACTION', 'INPUT MODE', 'THB SPENT', 'FEE (THB)', 'BTC PRICE (THB)', 'BTC BOUGHT', 'NOTE']);

  // data rows — sorted oldest first
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    const action = e.action || 'buy';
    rows.push([
      e.date,
      ACTION_LABEL[action] || 'BUY',
      e.input_mode || 'thb',
      e.thb_amount,
      e.fee_thb || 0,
      e.btc_price_thb,
      e.btc_bought,
      e.note || '',
    ]);
  }

  // ── convert to CSV string ────────────────────────────────────
  const csv = rows
    .map(row => row.map(cell => {
      const val = String(cell);
      // quote cells that contain commas, quotes, or newlines
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(','))
    .join('\r\n');

  // ── trigger download ─────────────────────────────────────────
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `dca-btc-history-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
