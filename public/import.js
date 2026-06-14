/* ================================================================
   CSV IMPORT — public/import.js
   Parses Bitkub trading history CSV (Thai format) and posts
   each valid THB_BTC row to POST /api/entries.
   ================================================================ */

/* ── Thai month name → month number ─────────────────────────── */
const THAI_MONTHS = {
  'มกราคม':   '01', 'กุมภาพันธ์': '02', 'มีนาคม':    '03',
  'เมษายน':   '04', 'พฤษภาคม':    '05', 'มิถุนายน':   '06',
  'กรกฎาคม':  '07', 'สิงหาคม':    '08', 'กันยายน':    '09',
  'ตุลาคม':   '10', 'พฤศจิกายน':  '11', 'ธันวาคม':    '12',
};

/* ── Parse Thai date "28/มกราคม/2025" → "2025-01-28" ────────── */
function parseThaiDate(raw) {
  if (!raw) return null;
  const parts = raw.trim().split('/');
  if (parts.length !== 3) return null;
  const [day, monthThai, year] = parts;
  const month = THAI_MONTHS[monthThai.trim()];
  if (!month) return null;
  return `${year.trim()}-${month}-${day.trim().padStart(2, '0')}`;
}

/* ── Strip commas and parse float ────────────────────────────── */
function parseNum(raw) {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return 0;
  return parseFloat(raw.replace(/,/g, '').trim()) || 0;
}

/* ── Parse entire CSV text → array of row objects ───────────── */
function parseCsv(text) {
  const lines = text.split('\n').map(l => l.trimEnd());
  const valid   = [];
  const skipped = [];

  for (const line of lines) {
    // skip blank lines and header/summary lines
    if (!line.trim()) continue;

    // split by comma — but quoted fields may contain commas
    const cols = splitCsvLine(line);
    if (cols.length < 6) continue;

    const dateRaw  = cols[0].trim();
    const name     = cols[1].trim();
    const thbRaw   = cols[2].trim();
    const priceRaw = cols[3].trim();
    const feeRaw   = cols[4].trim();
    const btcRaw   = cols[5].trim();

    // only import BTC rows
    if (name !== 'THB_BTC') continue;

    const date     = parseThaiDate(dateRaw);
    const thb      = parseNum(thbRaw);
    const price    = parseNum(priceRaw);
    const fee      = parseNum(feeRaw);
    const btcBought = parseNum(btcRaw);

    if (!date || thb <= 0 || price <= 0 || btcBought <= 0) {
      skipped.push({ raw: line, reason: 'Invalid data' });
      continue;
    }

    valid.push({ date, thb_amount: thb, btc_price_thb: price, fee_thb: fee, btc_bought: btcBought });
  }

  return { valid, skipped };
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
      _existingDates = entries.map(e => e.date + '_' + e.btc_bought);
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

/* ── Process CSV text → preview ─────────────────────────────── */
function processCSV(text) {
  const { valid, skipped } = parseCsv(text);

  // mark duplicates
  let dupeCount = 0;
  const rows = valid.map(row => {
    const key   = row.date + '_' + row.btc_bought;
    const isDupe = _existingDates.includes(key);
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
    tr.innerHTML = `
      <td>${row.date}</td>
      <td>฿${row.thb_amount.toLocaleString('th-TH')}</td>
      <td>฿${row.fee_thb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
      <td>฿${row.btc_price_thb.toLocaleString('th-TH')}</td>
      <td>${row.btc_bought.toFixed(8)}</td>
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
          thb_amount:    row.thb_amount,
          fee_thb:       row.fee_thb,
          btc_price_thb: row.btc_price_thb,
          btc_bought:    row.btc_bought,
          input_mode:    'thb',
          note:          'Imported from CSV',
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
  rows.push(['Total BTC',       entries.reduce((s, e) => s + e.btc_bought, 0).toFixed(8), 'BTC']);
  rows.push(['Total Invested',  summary.totalTHB.toLocaleString('th-TH'),                 'THB']);
  rows.push(['Avg Buy Price',   Math.round(summary.avgBuyPrice).toLocaleString('th-TH'),  'THB/BTC']);
  rows.push(['Total Entries',   entries.length]);
  rows.push(['Exported At',     new Date().toLocaleString('th-TH')]);
  rows.push([]);

  // column headers
  rows.push(['DATE', 'INPUT MODE', 'THB SPENT', 'FEE (THB)', 'BTC PRICE (THB)', 'BTC BOUGHT', 'NOTE']);

  // data rows — sorted oldest first
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    rows.push([
      e.date,
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
