/* ================================================================
   RETIREMENT TAB — public/retirement.js
   Include via: <script src="retirement.js"></script> in index.html
   Depends on: Chart.js (already used by the project or add via CDN)
   ================================================================ */

/* ── state ───────────────────────────────────────────────────── */
const Ret = {
  liveBtcPrice: null,         // kept in sync from the main app's WS feed
  summary: null,              // /api/summary response
  entries: null,              // /api/entries response
  charts: {},                 // Chart.js instances keyed by id
};

/* ── called by main app whenever WS price updates ───────────── */
function retirementUpdateLivePrice(priceThb) {
  Ret.liveBtcPrice = priceThb;
  const el = document.getElementById('ret-live-price');
  if (el) el.textContent = numberFmt(priceThb);
}

/* ── bootstrap: load data when tab becomes visible ──────────── */
async function retirementInit() {
  try {
    const [sumRes, entRes] = await Promise.all([
      fetch('/api/summary'),
      fetch('/api/entries'),
    ]);
    Ret.summary = await sumRes.json();
    Ret.entries = await entRes.json();

    // populate read-only fields
    document.getElementById('ret-current-btc').textContent =
      Ret.summary.totalBTC ? Ret.summary.totalBTC.toFixed(8) : '0.00000000';
    document.getElementById('ret-avg-price').textContent =
      Ret.summary.avgBuyPrice ? numberFmt(Math.round(Ret.summary.avgBuyPrice)) : '—';

    // estimate monthly DCA from last 3 months of entries
    const monthlyEst = estimateMonthlyDca(Ret.entries);
    const dcaInput = document.getElementById('ret-monthly-dca');
    if (dcaInput && monthlyEst > 0) dcaInput.value = Math.round(monthlyEst);

    // sync live price if already captured by main WS
    if (Ret.liveBtcPrice) retirementUpdateLivePrice(Ret.liveBtcPrice);

  } catch (e) {
    console.error('[Retirement] init error', e);
  }
}

/* ── estimate monthly DCA from last 90 days of entries ──────── */
function estimateMonthlyDca(entries) {
  if (!entries || !entries.length) return 0;
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = entries.filter(e => new Date(e.date).getTime() >= cutoff);
  if (!recent.length) {
    // fallback: use all entries averaged over their span
    const sorted = [...entries].sort((a,b) => new Date(a.date)-new Date(b.date));
    const spanMs  = new Date(sorted.at(-1).date) - new Date(sorted[0].date) || 1;
    const spanMo  = spanMs / (30 * 24 * 60 * 60 * 1000) || 1;
    const total   = entries.reduce((s,e) => s + (e.thb_amount||0), 0);
    return total / spanMo;
  }
  const total = recent.reduce((s, e) => s + (e.thb_amount || 0), 0);
  return total / 3; // spread over 3 months
}

/* ── main calculation ────────────────────────────────────────── */
function retirementCalculate() {
  const btn = document.getElementById('ret-calculate-btn');
  btn.classList.add('running');
  btn.textContent = '⟳ SIMULATING…';

  // small delay so UI repaints before heavy simulation
  setTimeout(() => {
    try {
      _doCalculation();
    } finally {
      btn.classList.remove('running');
      btn.textContent = '▶ RUN SIMULATION';
    }
  }, 50);
}

function _doCalculation() {
  // ── read inputs ──────────────────────────────────────────────
  const currentBtc   = Ret.summary?.total_btc || 0;
  const currentPrice = Ret.liveBtcPrice || Ret.summary?.currentPrice || 0;
  const ageNow       = parseFloat(document.getElementById('ret-age-now').value)    || 30;
  const ageRetire    = parseFloat(document.getElementById('ret-age-retire').value) || 50;
  const monthlyDca   = parseFloat(document.getElementById('ret-monthly-dca').value)   || 0;
  const dcaIncrease  = parseFloat(document.getElementById('ret-dca-increase').value) / 100 || 0;
  const withdrawThb  = parseFloat(document.getElementById('ret-withdraw').value)      || 0;
  const annualReturn = parseFloat(document.getElementById('ret-btc-return').value) / 100 || 0.40;
  const volatility   = parseFloat(document.getElementById('ret-volatility').value) / 100  || 0.70;
  const inflation    = parseFloat(document.getElementById('ret-inflation').value)  / 100  || 0.03;
  const lifespan     = parseFloat(document.getElementById('ret-lifespan').value)   || 85;

  const yearsToRetire  = Math.max(ageRetire - ageNow, 0);
  const yearsInRetire  = Math.max(lifespan  - ageRetire, 0);
  const monthlyReturn  = Math.pow(1 + annualReturn, 1/12) - 1;

  if (currentPrice <= 0) {
    alert('Waiting for live BTC price — please wait a moment and try again.');
    return;
  }

  // ── BASE CASE: accumulation phase ───────────────────────────
  const accData = accumulation(
    currentBtc, currentPrice, monthlyDca,
    annualReturn, yearsToRetire, dcaIncrease
  );
  const baseBtcRetire   = accData.btcHistory.at(-1);
  const basePriceRetire = accData.priceHistory.at(-1);
  const baseValueRetire = baseBtcRetire * basePriceRetire;

  // ── BASE CASE: withdrawal phase ──────────────────────────────
  const wdData = withdrawal(
    baseBtcRetire, basePriceRetire, withdrawThb,
    annualReturn, inflation, yearsInRetire
  );
  const baseRunway = wdData.runway;

  // ── MONTE CARLO (1 000 paths) ─────────────────────────────── 
  const MC_PATHS  = 1000;
  const MC_YEARS  = yearsToRetire + yearsInRetire;
  const mcResults = runMonteCarlo(
    currentBtc, currentPrice, monthlyDca,
    annualReturn, volatility, inflation,
    withdrawThb, yearsToRetire, yearsInRetire,
    MC_PATHS, dcaIncrease
  );
  const survivalProb = mcResults.survived / MC_PATHS;

  // ── update summary cards ─────────────────────────────────────
  setEl('ret-out-btc',    baseBtcRetire.toFixed(6) + ' ₿');
  setEl('ret-out-value',  '฿' + numberFmt(Math.round(baseValueRetire)));
  setEl('ret-out-runway', baseRunway >= yearsInRetire
    ? '∞ ' + yearsInRetire + '+ yrs' : baseRunway.toFixed(1) + ' yrs');
  setEl('ret-out-prob',   (survivalProb * 100).toFixed(1) + ' %');

  colorStatCard('ret-out-runway', baseRunway, yearsInRetire);
  colorStatCard('ret-out-prob', survivalProb, null, true);

  // ── render charts ─────────────────────────────────────────────
  renderAccumulationChart(accData, ageNow);
  renderMonteCarloChart(mcResults, ageNow, yearsToRetire, yearsInRetire);
  renderWithdrawalChart(wdData, ageRetire);
  renderScenarioTable(
    currentBtc, currentPrice, monthlyDca,
    annualReturn, withdrawThb, inflation,
    yearsToRetire, yearsInRetire, dcaIncrease
  );
}

/* ================================================================
   ACCUMULATION PHASE
   Returns arrays: { years, btcHistory, priceHistory, valueHistory }
================================================================ */
function accumulation(startBtc, startPrice, monthlyThb, annualReturn, years, dcaIncrease = 0) {
  const months       = years * 12;
  const monthlyRet   = Math.pow(1 + annualReturn, 1/12) - 1;
  let btc            = startBtc;
  let price          = startPrice;
  let dca            = monthlyThb;
  const btcHistory   = [btc];
  const priceHistory = [price];
  const valueHistory = [btc * price];
  const yearLabels   = [0];

  for (let m = 1; m <= months; m++) {
    price *= (1 + monthlyRet);
    if (dca > 0) btc += dca / price;
    if (m % 12 === 0) {
      btcHistory.push(btc);
      priceHistory.push(price);
      valueHistory.push(btc * price);
      yearLabels.push(m / 12);
      // increase DCA once per year
      if (dcaIncrease > 0) dca *= (1 + dcaIncrease);
    }
  }
  return { yearLabels, btcHistory, priceHistory, valueHistory };
}

/* ================================================================
   WITHDRAWAL PHASE
   Returns { yearLabels, btcHistory, valueHistory, runway }
================================================================ */
function withdrawal(startBtc, startPrice, monthlyWithdrawThb, annualReturn, inflation, years) {
  const monthlyRet = Math.pow(1 + annualReturn, 1/12) - 1;
  const monthlyInf = Math.pow(1 + inflation,    1/12) - 1;
  let btc          = startBtc;
  let price        = startPrice;
  let withdraw     = monthlyWithdrawThb;
  const btcHistory = [btc];
  const valueHistory = [btc * price];
  const yearLabels = [0];
  let runway = years;

  for (let m = 1; m <= years * 12; m++) {
    price    *= (1 + monthlyRet);
    withdraw *= (1 + monthlyInf);
    const btcNeeded = withdraw / price;
    btc -= btcNeeded;
    if (btc <= 0) {
      runway = m / 12;
      btc = 0;
    }
    if (m % 12 === 0) {
      btcHistory.push(Math.max(btc, 0));
      valueHistory.push(Math.max(btc * price, 0));
      yearLabels.push(m / 12);
    }
  }
  return { yearLabels, btcHistory, valueHistory, runway };
}

/* ================================================================
   MONTE CARLO
================================================================ */
function runMonteCarlo(
  startBtc, startPrice, monthlyDca,
  mu, sigma, inflation,
  monthlyWithdraw, yearsAccum, yearsRetire,
  nPaths, dcaIncrease = 0
) {
  const dt       = 1/12;
  const totalMo  = (yearsAccum + yearsRetire) * 12;
  const accumMo  = yearsAccum * 12;
  const retireMo = yearsRetire * 12;

  // store percentile paths (per year)
  const totalYears = yearsAccum + yearsRetire;
  const pathValues = Array.from({ length: totalYears + 1 }, () => []);
  let survived = 0;

  for (let p = 0; p < nPaths; p++) {
    let btc      = startBtc;
    let price    = startPrice;
    let dca      = monthlyDca;
    let withdraw = monthlyWithdraw;
    let broke    = false;

    for (let m = 1; m <= totalMo; m++) {
      // GBM price step
      const z    = randn();
      const logR = (mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z;
      price      = price * Math.exp(logR);

      if (m <= accumMo) {
        if (dca > 0) btc += dca / price;
        // increase DCA once per year during accumulation
        if (m % 12 === 0 && dcaIncrease > 0) dca *= (1 + dcaIncrease);
      } else {
        // withdrawal phase — inflation-adjusted
        if (m === accumMo + 1) withdraw = monthlyWithdraw; // reset to nominal
        withdraw *= Math.pow(1 + inflation, dt);
        const btcNeeded = withdraw / price;
        btc -= btcNeeded;
        if (btc <= 0 && !broke) { broke = true; btc = 0; }
      }

      if (m % 12 === 0) {
        const yr = m / 12;
        pathValues[yr].push(btc * price);
      }
    }
    if (!broke) survived++;
  }

  // compute percentile bands per year
  const p10 = [], p50 = [], p90 = [];
  for (let yr = 0; yr <= totalYears; yr++) {
    const vals = (pathValues[yr] || [startPrice * startBtc]).sort((a,b)=>a-b);
    p10.push(percentile(vals, 0.10));
    p50.push(percentile(vals, 0.50));
    p90.push(percentile(vals, 0.90));
  }

  return { p10, p50, p90, survived, nPaths, totalYears, yearsAccum };
}

/* ── Box-Muller normal random ───────────────────────────────── */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] || 0;
}

/* ================================================================
   CHARTS
================================================================ */

/* shared Chart.js defaults matching cyberpunk theme */
const RET_CHART_DEFAULTS = {
  responsive: true,
  animation: { duration: 600 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.85)',
      borderColor: 'rgba(0,245,255,0.4)',
      borderWidth: 1,
      titleFont: { family: 'Share Tech Mono' },
      bodyFont:  { family: 'Share Tech Mono' },
    },
  },
  scales: {
    x: {
      ticks: { color: 'rgba(255,255,255,0.35)', font: { family: 'Share Tech Mono', size: 10 } },
      grid:  { color: 'rgba(255,255,255,0.05)' },
    },
    y: {
      ticks: { color: 'rgba(255,255,255,0.35)', font: { family: 'Share Tech Mono', size: 10 },
               callback: v => compactFmt(v) },
      grid:  { color: 'rgba(255,255,255,0.05)' },
    },
  },
};

function getOrCreateChart(id, type, data, options) {
  if (Ret.charts[id]) Ret.charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  Ret.charts[id] = new Chart(ctx, { type, data, options });
}

function renderAccumulationChart(accData, ageNow) {
  const labels = accData.yearLabels.map(y => `Age ${ageNow + y}`);
  getOrCreateChart('ret-chart-accumulation', 'line', {
    labels,
    datasets: [
      {
        label: 'BTC',
        data: accData.btcHistory,
        borderColor: '#00f5ff',
        backgroundColor: 'rgba(0,245,255,0.06)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        yAxisID: 'yBtc',
      },
      {
        label: 'Portfolio (THB)',
        data: accData.valueHistory,
        borderColor: '#f5e642',
        borderDash: [4,3],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'yThb',
      },
    ],
  }, {
    ...RET_CHART_DEFAULTS,
    plugins: {
      ...RET_CHART_DEFAULTS.plugins,
      legend: {
        display: true,
        labels: { color: 'rgba(255,255,255,0.5)', font: { family: 'Share Tech Mono', size: 10 } },
      },
    },
    scales: {
      x: RET_CHART_DEFAULTS.scales.x,
      yBtc: {
        type: 'linear', position: 'left',
        ticks: { color: '#00f5ff', font: { family: 'Share Tech Mono', size: 10 },
                 callback: v => v.toFixed(4) + ' ₿' },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      yThb: {
        type: 'linear', position: 'right',
        ticks: { color: '#f5e642', font: { family: 'Share Tech Mono', size: 10 },
                 callback: v => '฿' + compactFmt(v) },
        grid: { drawOnChartArea: false },
      },
    },
  });
}

function renderMonteCarloChart(mc, ageNow, yearsAccum, yearsRetire) {
  const labels = Array.from({ length: mc.totalYears + 1 }, (_, i) => `Age ${ageNow + i}`);

  // vertical line at retirement year
  const retireAnnotation = mc.yearsAccum;

  getOrCreateChart('ret-chart-monte-carlo', 'line', {
    labels,
    datasets: [
      {
        label: '90th pct',
        data: mc.p90,
        borderColor: '#00f5ff',
        backgroundColor: 'rgba(0,245,255,0.08)',
        fill: '+1',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: 'Median',
        data: mc.p50,
        borderColor: '#f5e642',
        backgroundColor: 'rgba(245,230,66,0.05)',
        fill: '+1',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: '10th pct',
        data: mc.p10,
        borderColor: '#ff3a5c',
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ],
  }, {
    ...RET_CHART_DEFAULTS,
    plugins: {
      ...RET_CHART_DEFAULTS.plugins,
      legend: {
        display: true,
        labels: { color: 'rgba(255,255,255,0.5)', font: { family: 'Share Tech Mono', size: 10 } },
      },
      annotation: undefined, // extend with chartjs-plugin-annotation if desired
    },
    scales: {
      x: RET_CHART_DEFAULTS.scales.x,
      y: {
        ...RET_CHART_DEFAULTS.scales.y,
        ticks: {
          ...RET_CHART_DEFAULTS.scales.y.ticks,
          callback: v => '฿' + compactFmt(v),
        },
      },
    },
  });
}

function renderWithdrawalChart(wdData, ageRetire) {
  const labels = wdData.yearLabels.map(y => `Age ${ageRetire + y}`);
  getOrCreateChart('ret-chart-withdrawal', 'line', {
    labels,
    datasets: [
      {
        label: 'BTC Remaining',
        data: wdData.btcHistory,
        borderColor: '#ff3a5c',
        backgroundColor: 'rgba(255,58,92,0.07)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  }, {
    ...RET_CHART_DEFAULTS,
    scales: {
      x: RET_CHART_DEFAULTS.scales.x,
      y: {
        ...RET_CHART_DEFAULTS.scales.y,
        ticks: {
          ...RET_CHART_DEFAULTS.scales.y.ticks,
          callback: v => v.toFixed(4) + ' ₿',
        },
      },
    },
  });
}

function renderScenarioTable(
  currentBtc, currentPrice, monthlyDca,
  baseReturn, withdrawThb, inflation,
  yearsToRetire, yearsInRetire, dcaIncrease = 0
) {
  const scenarios = [
    { label: 'Bear',  ret: baseReturn * 0.3,  cls: 'bear' },
    { label: 'Base',  ret: baseReturn,         cls: 'base' },
    { label: 'Bull',  ret: baseReturn * 2.0,   cls: 'bull' },
  ];

  const tbody = document.getElementById('ret-scenario-tbody');
  tbody.innerHTML = '';

  scenarios.forEach(s => {
    const acc = accumulation(currentBtc, currentPrice, monthlyDca, s.ret, yearsToRetire, dcaIncrease);
    const btcR  = acc.btcHistory.at(-1);
    const priceR = acc.priceHistory.at(-1);
    const valueR = btcR * priceR;
    const wd  = withdrawal(btcR, priceR, withdrawThb, s.ret, inflation, yearsInRetire);
    const tr = document.createElement('tr');
    tr.className = s.cls;
    tr.innerHTML = `
      <td>${s.label}</td>
      <td>${(s.ret * 100).toFixed(0)} %/yr</td>
      <td>${btcR.toFixed(4)} ₿</td>
      <td>฿${numberFmt(Math.round(valueR))}</td>
      <td>${wd.runway >= yearsInRetire ? '✓ ' + yearsInRetire + '+ yrs' : wd.runway.toFixed(1) + ' yrs'}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('ret-scenario-table').style.display = 'block';
}

/* ================================================================
   HELPERS
================================================================ */
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function colorStatCard(valueId, value, threshold, isProb) {
  const card = document.getElementById(valueId)?.closest('.ret-stat-card');
  const el   = document.getElementById(valueId);
  if (!card || !el) return;
  card.classList.remove('highlight','danger','warn');
  el.classList.remove('good','warn','bad');

  if (isProb) {
    if (value >= 0.8)       { card.classList.add('highlight'); el.classList.add('good'); }
    else if (value >= 0.5)  { card.classList.add('warn');      el.classList.add('warn'); }
    else                    { card.classList.add('danger');    el.classList.add('bad'); }
  } else {
    if (value >= threshold) { card.classList.add('highlight'); el.classList.add('good'); }
    else if (value >= threshold * 0.6) { card.classList.add('warn'); el.classList.add('warn'); }
    else                    { card.classList.add('danger');    el.classList.add('bad'); }
  }
}

function numberFmt(n) {
  return n.toLocaleString('th-TH');
}

function compactFmt(v) {
  if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v/1e3).toFixed(0) + 'K';
  return v.toFixed(0);
}