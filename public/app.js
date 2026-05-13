/* ═══════════════════════════════════════════════════════
   DCA₿ TRACKER — Frontend App
   Two input modes: THB+Fee → BTC  |  BTC amount + Price
   Real-time price via Bitkub WebSocket
   ═══════════════════════════════════════════════════════ */

const API    = "";
const WS_URL = "wss://api.bitkub.com/websocket-api/market.ticker.thb_btc";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);

// Header
const livePrice      = $("livePrice");
const priceUpdated   = $("priceUpdated");

// Summary cards
const statTotalBTC   = $("statTotalBTC");
const statTotalTHB   = $("statTotalTHB");
const statAvgPrice   = $("statAvgPrice");
const statPnl        = $("statPnl");
const statPnlPct     = $("statPnlPct");
const statCurrentVal = $("statCurrentVal");
const statEntries    = $("statEntries");
const cardPnl        = $("cardPnl");

// Table
const historyCount   = $("historyCount");
const tableBody      = $("tableBody");

// ── Add form (MODE 1: THB) ────────────────────────────────────────────────────
const tabTHB         = $("tabTHB");
const tabBTC         = $("tabBTC");
const modeThbFields  = $("modeThbFields");
const modeBtcFields  = $("modeBtcFields");
const inputDate      = $("inputDate");
const inputTHB       = $("inputTHB");
const inputFee       = $("inputFee");
const inputBTCPrice  = $("inputBTCPrice");
const btnAutoPrice   = $("btnAutoPrice");
const previewNetTHB  = $("previewNetTHB");
const previewFeeTHB  = $("previewFeeTHB");
const previewBTC     = $("previewBTC");

// ── Add form (MODE 2: BTC amount) ─────────────────────────────────────────────
const inputBTCAmount   = $("inputBTCAmount");
const inputBTCPrice2   = $("inputBTCPrice2");
const btnAutoPrice2    = $("btnAutoPrice2");
const inputFee2        = $("inputFee2");
const previewTHBfromBTC= $("previewTHBfromBTC");
const previewFee2      = $("previewFee2");
const previewBTC2      = $("previewBTC2");

const inputNote      = $("inputNote");
const btnSubmit      = $("btnSubmit");

// ── Edit modal ────────────────────────────────────────────────────────────────
const modalOverlay       = $("modalOverlay");
const modalClose         = $("modalClose");
const btnCancel          = $("btnCancel");
const btnSaveEdit        = $("btnSaveEdit");
const editTabTHB         = $("editTabTHB");
const editTabBTC         = $("editTabBTC");
const editModeThbFields  = $("editModeThbFields");
const editModeBtcFields  = $("editModeBtcFields");
const editDate           = $("editDate");
const editTHB            = $("editTHB");
const editFee            = $("editFee");
const editBTCPrice       = $("editBTCPrice");
const editPreviewNetTHB  = $("editPreviewNetTHB");
const editPreviewFee     = $("editPreviewFee");
const editPreviewBTC     = $("editPreviewBTC");
const editBTCAmount      = $("editBTCAmount");
const editBTCPrice2      = $("editBTCPrice2");
const editFee2           = $("editFee2");
const editPreviewTHBfromBTC = $("editPreviewTHBfromBTC");
const editPreviewFee2    = $("editPreviewFee2");
const editPreviewBTC2    = $("editPreviewBTC2");
const editNote           = $("editNote");
const toast              = $("toast");

// ── State ─────────────────────────────────────────────────────────────────────
let currentLivePrice = null;
let inputMode        = "thb";   // "thb" | "btc"
let editMode         = "thb";
let editingId        = null;
let ws               = null;
let wsReconnectTimer = null;
let wsReconnectDelay = 2000;

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = {
  thb: v  => "฿" + Number(v).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  btc: v  => Number(v).toFixed(8),
  pct: v  => (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%",
  fee: v  => v ? "฿" + Number(v).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—",
};

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className   = "toast show" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.className = "toast", 2800);
}

function setDefaultDate() { inputDate.value = new Date().toISOString().split("T")[0]; }

// ── WebSocket price ───────────────────────────────────────────────────────────
function setWsDot(status) {
  const dot = document.querySelector(".live-dot");
  dot.style.background = { live:"var(--green)", connecting:"var(--yellow)", reconnecting:"var(--yellow)", error:"var(--red)" }[status] || "var(--text-dim)";
}

function onPriceUpdate(price) {
  currentLivePrice = price;
  livePrice.textContent    = "฿" + Number(price).toLocaleString("th-TH");
  priceUpdated.textContent = `WS LIVE · Bitkub · ${new Date().toLocaleTimeString("th-TH")}`;
  fetch(`${API}/api/price-cache`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ price }),
  }).catch(() => {});
  updateAddPreview();
  refreshSummary();
  if (typeof refreshGoal === "function") refreshGoal();
}

function connectWebSocket() {
  if (ws) ws.close();
  clearTimeout(wsReconnectTimer);
  setWsDot("connecting");
  priceUpdated.textContent = "connecting...";
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { setWsDot("live"); wsReconnectDelay = 2000; };
  ws.onmessage = evt => {
    try {
      const d = JSON.parse(evt.data);
      const price = parseFloat(d?.last ?? d?.data?.last ?? d?.close);
      if (price > 0) onPriceUpdate(price);
    } catch {}
  };
  ws.onerror = () => setWsDot("error");
  ws.onclose = () => {
    setWsDot("reconnecting");
    priceUpdated.textContent = `reconnecting in ${wsReconnectDelay / 1000}s...`;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30_000);
      connectWebSocket();
    }, wsReconnectDelay);
  };
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ws?.readyState !== WebSocket.OPEN) connectWebSocket();
});

// ── Mode Tabs ─────────────────────────────────────────────────────────────────
function switchAddMode(mode) {
  inputMode = mode;
  tabTHB.classList.toggle("active", mode === "thb");
  tabBTC.classList.toggle("active", mode === "btc");
  modeThbFields.classList.toggle("hidden", mode !== "thb");
  modeBtcFields.classList.toggle("hidden", mode !== "btc");
  updateAddPreview();
}

tabTHB.addEventListener("click", () => switchAddMode("thb"));
tabBTC.addEventListener("click", () => switchAddMode("btc"));

function switchEditMode(mode) {
  editMode = mode;
  editTabTHB.classList.toggle("active", mode === "thb");
  editTabBTC.classList.toggle("active", mode === "btc");
  editModeThbFields.classList.toggle("hidden", mode !== "thb");
  editModeBtcFields.classList.toggle("hidden", mode !== "btc");
  updateEditPreview();
}

editTabTHB.addEventListener("click", () => switchEditMode("thb"));
editTabBTC.addEventListener("click", () => switchEditMode("btc"));

// ── Preview calculators ───────────────────────────────────────────────────────
function calcThbMode(thb, feePct, price) {
  if (!thb || !price || thb <= 0 || price <= 0) return null;
  const feeTHB = thb * (feePct || 0) / 100;
  const netTHB = thb - feeTHB;
  const rawBtc = netTHB / price;

  // Truncate to 8 decimal places without rounding
  // Multiplying by 10^8 shifts the decimal, floor() removes the rest, then we shift back.
  const btc = Math.floor(rawBtc * 1e8) / 1e8;
  return { feeTHB, netTHB, btc };
}

function calcBtcMode(btcAmt, price, feeTHB) {
  if (!btcAmt || !price || btcAmt <= 0 || price <= 0) return null;
  const thbSpent = btcAmt * price + (feeTHB || 0);
  return { thbSpent, btc: btcAmt, feeTHB: feeTHB || 0 };
}

function updateAddPreview() {
  if (inputMode === "thb") {
    const r = calcThbMode(
      parseFloat(inputTHB.value),
      parseFloat(inputFee.value),
      parseFloat(inputBTCPrice.value)
    );
    previewNetTHB.textContent = r ? fmt.thb(r.netTHB) : "—";
    previewFeeTHB.textContent = r ? fmt.fee(r.feeTHB) : "—";
    previewBTC.textContent    = r ? "₿ " + fmt.btc(r.btc) : "—";
  } else {
    const r = calcBtcMode(
      parseFloat(inputBTCAmount.value),
      parseFloat(inputBTCPrice2.value),
      parseFloat(inputFee2.value)
    );
    previewTHBfromBTC.textContent = r ? fmt.thb(r.thbSpent) : "—";
    previewFee2.textContent       = r ? fmt.fee(r.feeTHB) : "—";
    previewBTC2.textContent       = r ? "₿ " + fmt.btc(r.btc) : "—";
  }
}

function updateEditPreview() {
  if (editMode === "thb") {
    const r = calcThbMode(
      parseFloat(editTHB.value),
      parseFloat(editFee.value),
      parseFloat(editBTCPrice.value)
    );
    editPreviewNetTHB.textContent = r ? fmt.thb(r.netTHB) : "—";
    editPreviewFee.textContent    = r ? fmt.fee(r.feeTHB) : "—";
    editPreviewBTC.textContent    = r ? "₿ " + fmt.btc(r.btc) : "—";
  } else {
    const r = calcBtcMode(
      parseFloat(editBTCAmount.value),
      parseFloat(editBTCPrice2.value),
      parseFloat(editFee2.value)
    );
    editPreviewTHBfromBTC.textContent = r ? fmt.thb(r.thbSpent) : "—";
    editPreviewFee2.textContent       = r ? fmt.fee(r.feeTHB) : "—";
    editPreviewBTC2.textContent       = r ? "₿ " + fmt.btc(r.btc) : "—";
  }
}

// Wire up all inputs for live preview
[inputTHB, inputFee, inputBTCPrice, inputBTCAmount, inputBTCPrice2, inputFee2]
  .forEach(el => el.addEventListener("input", updateAddPreview));
[editTHB, editFee, editBTCPrice, editBTCAmount, editBTCPrice2, editFee2]
  .forEach(el => el.addEventListener("input", updateEditPreview));

// Live price buttons
btnAutoPrice.addEventListener("click", () => {
  if (currentLivePrice) { inputBTCPrice.value = currentLivePrice; updateAddPreview(); showToast("⚡ Live price applied"); }
  else showToast("ยังไม่มีราคา...", true);
});
btnAutoPrice2.addEventListener("click", () => {
  if (currentLivePrice) { inputBTCPrice2.value = currentLivePrice; updateAddPreview(); showToast("⚡ Live price applied"); }
  else showToast("ยังไม่มีราคา...", true);
});

// ── Submit form ───────────────────────────────────────────────────────────────
btnSubmit.addEventListener("click", async () => {
  const date = inputDate.value;
  const note = inputNote.value.trim();
  if (!date) return showToast("กรุณาเลือกวันที่", true);

  let payload;

  if (inputMode === "thb") {
    const thb    = parseFloat(inputTHB.value);
    const feePct = parseFloat(inputFee.value) || 0;
    const price  = parseFloat(inputBTCPrice.value);
    if (!thb || thb <= 0)    return showToast("กรอกจำนวน THB", true);
    if (!price || price <= 0) return showToast("กรอกราคา BTC", true);
    const r = calcThbMode(thb, feePct, price);
    payload = { date, thb_amount: thb, fee_thb: r.feeTHB, btc_price_thb: price, btc_bought: r.btc, input_mode: "thb", note };
  } else {
    const btcAmt = parseFloat(inputBTCAmount.value);
    const price  = parseFloat(inputBTCPrice2.value);
    const feeTHB = parseFloat(inputFee2.value) || 0;
    if (!btcAmt || btcAmt <= 0) return showToast("กรอกจำนวน BTC", true);
    if (!price || price <= 0)   return showToast("กรอกราคา BTC", true);
    const r = calcBtcMode(btcAmt, price, feeTHB);
    payload = { date, thb_amount: r.thbSpent, fee_thb: feeTHB, btc_price_thb: price, btc_bought: btcAmt, input_mode: "btc", note };
  }

  btnSubmit.textContent = "LOGGING...";
  btnSubmit.disabled    = true;
  try {
    const res = await fetch(`${API}/api/entries`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    showToast("✓ บันทึก DCA เรียบร้อย!");
    inputTHB.value = ""; inputFee.value = ""; inputBTCPrice.value = "";
    inputBTCAmount.value = ""; inputBTCPrice2.value = ""; inputFee2.value = "";
    inputNote.value = "";
    updateAddPreview(); setDefaultDate(); await refresh();
  } catch {
    showToast("❌ บันทึกไม่สำเร็จ", true);
  } finally {
    btnSubmit.innerHTML = '<span class="btn-icon">+</span> LOG DCA ORDER';
    btnSubmit.disabled  = false;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
async function refreshSummary() {
  try {
    const res = await fetch(`${API}/api/summary`);
    const s   = await res.json();
    statTotalBTC.textContent   = fmt.btc(s.totalBTC);
    statTotalTHB.textContent   = fmt.thb(s.totalTHB);
    statAvgPrice.textContent   = fmt.thb(s.avgBuyPrice);
    statCurrentVal.textContent = fmt.thb(s.currentValueTHB);
    statEntries.textContent    = s.entryCount;
    statPnl.textContent        = (s.pnlTHB >= 0 ? "+" : "") + fmt.thb(s.pnlTHB);
    statPnlPct.textContent     = fmt.pct(s.pnlPct);
    statPnlPct.style.color     = s.pnlTHB >= 0 ? "var(--green)" : "var(--red)";
    cardPnl.classList.toggle("positive", s.pnlTHB >= 0);
    cardPnl.classList.toggle("negative", s.pnlTHB < 0);
  } catch {}
}

// ── History ───────────────────────────────────────────────────────────────────
async function refreshEntries() {
  try {
    const res     = await fetch(`${API}/api/entries`);
    const entries = await res.json();
    historyCount.textContent = `${entries.length} record${entries.length !== 1 ? "s" : ""}`;
    if (!entries.length) {
      tableBody.innerHTML = `<tr class="empty-row"><td colspan="7">
        <div class="empty-state">
          <div class="empty-icon">₿</div>
          <div>NO DCA ENTRIES YET</div>
          <div class="empty-sub">Log your first order above</div>
        </div></td></tr>`;
      return;
    }
    tableBody.innerHTML = entries.map(e => `
      <tr data-id="${e.id}">
        <td class="td-date">${e.date}</td>
        <td class="td-thb">${fmt.thb(e.thb_amount)}</td>
        <td class="td-fee">${fmt.fee(e.fee_thb)}</td>
        <td class="td-price">${fmt.thb(e.btc_price_thb)}</td>
        <td class="td-btc">₿ ${fmt.btc(e.btc_bought)}</td>
        <td class="td-note">${esc(e.note || "—")}</td>
        <td>
          <button class="btn-edit"   data-id="${e.id}">EDIT</button>
          <button class="btn-delete" data-id="${e.id}">DEL</button>
        </td>
      </tr>`).join("");
    const map = Object.fromEntries(entries.map(e => [e.id, e]));
    tableBody.querySelectorAll(".btn-edit").forEach(btn =>
      btn.addEventListener("click", () => openEditModal(map[+btn.dataset.id]))
    );
    tableBody.querySelectorAll(".btn-delete").forEach(btn =>
      btn.addEventListener("click", () => deleteEntry(+btn.dataset.id))
    );
  } catch {}
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function deleteEntry(id) {
  if (!confirm("Delete this DCA entry?")) return;
  await fetch(`${API}/api/entries/${id}`, { method: "DELETE" });
  showToast("Entry deleted");
  await refresh();
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function openEditModal(entry) {
  editingId = entry.id;

  // Decide which tab to show based on saved input_mode
  const mode = entry.input_mode || "thb";
  switchEditMode(mode);

  editDate.value = entry.date;
  editNote.value = entry.note || "";

  if (mode === "thb") {
    editTHB.value      = entry.thb_amount;
    editBTCPrice.value = entry.btc_price_thb;
    // back-calc fee% from stored fee_thb
    const feePct = entry.thb_amount > 0 ? ((entry.fee_thb || 0) / entry.thb_amount * 100) : 0;
    editFee.value = feePct.toFixed(2);
  } else {
    editBTCAmount.value = entry.btc_bought;
    editBTCPrice2.value = entry.btc_price_thb;
    editFee2.value      = entry.fee_thb || 0;
  }
  updateEditPreview();
  modalOverlay.classList.add("open");
}

function closeEditModal() { modalOverlay.classList.remove("open"); editingId = null; }
modalClose.addEventListener("click", closeEditModal);
btnCancel.addEventListener("click", closeEditModal);
modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeEditModal(); });

btnSaveEdit.addEventListener("click", async () => {
  const date = editDate.value;
  const note = editNote.value.trim();
  if (!date) return showToast("กรุณาเลือกวันที่", true);

  let payload;
  if (editMode === "thb") {
    const thb    = parseFloat(editTHB.value);
    const feePct = parseFloat(editFee.value) || 0;
    const price  = parseFloat(editBTCPrice.value);
    if (!thb || !price) return showToast("กรอกข้อมูลให้ครบ", true);
    const r = calcThbMode(thb, feePct, price);
    payload = { date, thb_amount: thb, fee_thb: r.feeTHB, btc_price_thb: price, btc_bought: r.btc, input_mode: "thb", note };
  } else {
    const btcAmt = parseFloat(editBTCAmount.value);
    const price  = parseFloat(editBTCPrice2.value);
    const feeTHB = parseFloat(editFee2.value) || 0;
    if (!btcAmt || !price) return showToast("กรอกข้อมูลให้ครบ", true);
    const r = calcBtcMode(btcAmt, price, feeTHB);
    payload = { date, thb_amount: r.thbSpent, fee_thb: feeTHB, btc_price_thb: price, btc_bought: btcAmt, input_mode: "btc", note };
  }

  btnSaveEdit.textContent = "SAVING...";
  btnSaveEdit.disabled    = true;
  try {
    const res = await fetch(`${API}/api/entries/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    showToast("✓ แก้ไขเรียบร้อย!");
    closeEditModal();
    await refresh();
  } catch {
    showToast("❌ บันทึกไม่สำเร็จ", true);
  } finally {
    btnSaveEdit.innerHTML = '<span class="btn-icon">✓</span> SAVE CHANGES';
    btnSaveEdit.disabled  = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function refresh() {
  await Promise.all([refreshSummary(), refreshEntries()]);
  await refreshGoal();
}

async function init() {
  setDefaultDate();
  switchAddMode("thb");
  connectWebSocket();
  await refresh();
}

init();

// ═══════════════════════════════════════════════════════
//  STACK GOAL
// ═══════════════════════════════════════════════════════
const btnEditGoal   = $("btnEditGoal");
const goalForm      = $("goalForm");
const goalInput     = $("goalInput");
const goalMonthlyTHB= $("goalMonthlyTHB");
const btnSaveGoal   = $("btnSaveGoal");
const btnCancelGoal = $("btnCancelGoal");
const goalNoTarget  = $("goalNoTarget");
const goalProgressWrap = $("goalProgressWrap");
const goalStacked   = $("goalStacked");
const goalTarget    = $("goalTarget");
const goalPct       = $("goalPct");
const goalBarFill   = $("goalBarFill");
const goalBarGlow   = $("goalBarGlow");
const goalRemaining = $("goalRemaining");
const goalMonthsLabel = $("goalMonthsLabel");
const goalETA       = $("goalETA");

let goalData = null;

function openGoalForm() {
  goalForm.classList.remove("hidden");
  if (goalData) {
    goalInput.value      = goalData.target_btc;
    goalMonthlyTHB.value = goalData.monthly_thb || "";
  }
  btnEditGoal.textContent = "✕ CLOSE";
}
function closeGoalForm() {
  goalForm.classList.add("hidden");
  btnEditGoal.textContent = "⚙ SET GOAL";
}

btnEditGoal.addEventListener("click", () =>
  goalForm.classList.contains("hidden") ? openGoalForm() : closeGoalForm()
);
btnCancelGoal.addEventListener("click", closeGoalForm);

btnSaveGoal.addEventListener("click", async () => {
  const target  = parseFloat(goalInput.value);
  const monthly = parseFloat(goalMonthlyTHB.value) || 0;
  if (!target || target <= 0) return showToast("กรอก Target BTC ให้ถูกต้อง", true);

  try {
    const res = await fetch(`${API}/api/goal`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_btc: target, monthly_thb: monthly }),
    });
    goalData = await res.json();
    showToast("🎯 Goal saved!");
    closeGoalForm();
    await refreshGoal();
  } catch { showToast("บันทึกไม่สำเร็จ", true); }
});

async function refreshGoal() {
  try {
    if (!goalData) {
      const res = await fetch(`${API}/api/goal`);
      goalData  = res.ok ? await res.json() : null;
    }

    // Need current total BTC from summary (fetch separately to avoid race)
    const sumRes  = await fetch(`${API}/api/summary`);
    const summary = await sumRes.json();
    const stacked = summary.totalBTC || 0;

    if (!goalData || !goalData.target_btc) {
      goalNoTarget.classList.remove("hidden");
      goalProgressWrap.classList.add("hidden");
      goalETA.textContent = "";
      return;
    }

    goalNoTarget.classList.add("hidden");
    goalProgressWrap.classList.remove("hidden");

    const target    = goalData.target_btc;
    const remaining = Math.max(target - stacked, 0);
    const pct       = Math.min((stacked / target) * 100, 100);
    const complete  = stacked >= target;

    goalStacked.textContent  = fmt.btc(stacked);
    goalTarget.textContent   = fmt.btc(target);
    goalPct.textContent      = pct.toFixed(1) + "%";
    goalRemaining.textContent = fmt.btc(remaining) + " BTC";

    goalBarFill.style.width = pct + "%";
    goalBarGlow.style.width = pct + "%";
    goalBarFill.classList.toggle("complete", complete);

    if (complete) {
      goalMonthsLabel.textContent = "🎉 GOAL ACHIEVED!";
      goalMonthsLabel.style.color = "var(--green)";
      goalETA.textContent = "✓ COMPLETE";
      goalETA.style.color = "var(--green)";
      return;
    }

    goalMonthsLabel.style.color = "";
    goalETA.style.color         = "";

    // ETA estimate using monthly DCA amount + current BTC price
    if (goalData.monthly_thb && currentLivePrice && currentLivePrice > 0) {
      const btcPerMonth = goalData.monthly_thb / currentLivePrice;
      if (btcPerMonth > 0) {
        const months = Math.ceil(remaining / btcPerMonth);
        const eta    = new Date();
        eta.setMonth(eta.getMonth() + months);
        const etaStr = eta.toLocaleDateString("th-TH", { month: "short", year: "numeric" });
        goalMonthsLabel.textContent = `~${months} เดือน (ถึง ${etaStr})`;
        goalETA.textContent         = `ETA ${etaStr}`;
      }
    } else {
      goalMonthsLabel.textContent = goalData.monthly_thb ? "กำลังรอราคา..." : "ตั้ง DCA/เดือน เพื่อดู ETA";
    }
  } catch (e) { console.error("Goal refresh failed:", e); }
}

// Extend the existing refresh function to also update goal
const _originalRefresh = refresh;
// Override refresh to include goal
window.refresh = refresh;
const _origRefreshGoal = refreshGoal;

// Hook goal refresh into price updates
const _origOnPriceUpdate = onPriceUpdate;

// Re-run goal ETA calc when price updates
document.addEventListener("priceUpdated", () => refreshGoal());