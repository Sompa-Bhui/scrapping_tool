/**
 * Email Scraping Tool — Frontend Client
 * Handles Socket.IO, UI interactions, and real-time updates
 */

// ── Socket.IO Connection ──
const isBackendOrigin = window.location.port === '3000';
const API_BASE = isBackendOrigin ? '' : 'http://localhost:3000';
const socket = io(API_BASE);

// ── DOM Elements ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  keyword: $('#keyword'),
  pages: $('#pages'),
  workers: $('#workers'),
  delayMin: $('#delayMin'),
  delayMax: $('#delayMax'),
  delayMinVal: $('#delayMinVal'),
  delayMaxVal: $('#delayMaxVal'),
  filterFree: $('#filterFree'),
  btnStart: $('#btnStart'),
  btnPause: $('#btnPause'),
  btnResume: $('#btnResume'),
  btnStop: $('#btnStop'),
  btnClear: $('#btnClear'),
  logContainer: $('#logContainer'),
  resultsBody: $('#resultsBody'),
  tableSearch: $('#tableSearch'),
  selectAllCb: $('#selectAllCb'),
  btnSelectAll: $('#btnSelectAll'),
  btnBulkDelete: $('#btnBulkDelete'),
  progressFill: $('#progressFill'),
  progressText: $('#progressText'),
  statusBadge: $('#statusBadge'),
  resultCount: $('#resultCount'),
  captchaModal: $('#captchaModal'),
  captchaMessage: $('#captchaMessage'),
  themeToggle: $('#themeToggle')
};

// ── State ──
let currentMode = 'balanced';
let allResults = [];
let selectedIds = new Set();
let isRunning = false;
let firstLog = true;
let connectionErrorShown = false;

// ── Theme Toggle ──
els.themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  els.themeToggle.textContent = next === 'dark' ? '🌙' : '☀️';
});

// ── Mode Selector ──
$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    // Apply mode presets
    const presets = { safe: [5, 10], balanced: [2, 7], fast: [1, 3] };
    const [min, max] = presets[currentMode];
    els.delayMin.value = min;
    els.delayMax.value = max;
    els.delayMinVal.textContent = min;
    els.delayMaxVal.textContent = max;
  });
});

// ── Range Sliders ──
els.delayMin.addEventListener('input', () => {
  let v = parseInt(els.delayMin.value);
  if (v >= parseInt(els.delayMax.value)) {
    els.delayMax.value = v + 1;
    els.delayMaxVal.textContent = v + 1;
  }
  els.delayMinVal.textContent = v;
});
els.delayMax.addEventListener('input', () => {
  let v = parseInt(els.delayMax.value);
  if (v <= parseInt(els.delayMin.value)) {
    els.delayMin.value = v - 1;
    els.delayMinVal.textContent = v - 1;
  }
  els.delayMaxVal.textContent = v;
});

// ── Ripple Effect ──
function addRipple(e, btn) {
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}
$$('.btn').forEach(btn => {
  btn.addEventListener('click', (e) => addRipple(e, btn));
});

// ── Button State Management ──
function setButtonStates(state) {
  isRunning = state !== 'idle' && state !== 'stopped' && state !== 'completed';
  els.btnStart.disabled = isRunning;
  els.btnPause.disabled = !isRunning || state === 'paused';
  els.btnResume.disabled = state !== 'paused';
  els.btnStop.disabled = !isRunning && state !== 'paused';
  if (state === 'searching' || state === 'scraping') {
    els.btnStart.classList.add('loading');
  } else {
    els.btnStart.classList.remove('loading');
  }
}

// ── API Calls ──
async function apiCall(endpoint, method = 'POST', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}/api/${endpoint}`, opts);
  return res.json();
}

// ── Start Scraping ──
els.btnStart.addEventListener('click', async () => {
  const keyword = els.keyword.value.trim();
  if (!keyword) {
    els.keyword.style.borderColor = '#ef4444';
    els.keyword.focus();
    setTimeout(() => els.keyword.style.borderColor = '', 2000);
    return;
  }
  firstLog = true;
  await apiCall('scrape/start', 'POST', {
    keyword,
    pages: parseInt(els.pages.value),
    workers: parseInt(els.workers.value),
    delayMin: parseInt(els.delayMin.value),
    delayMax: parseInt(els.delayMax.value),
    mode: currentMode,
    filterFreeProviders: els.filterFree.checked
  });
});

els.btnPause.addEventListener('click', () => apiCall('scrape/pause'));
els.btnResume.addEventListener('click', () => apiCall('scrape/resume'));
els.btnStop.addEventListener('click', () => apiCall('scrape/stop'));
els.btnClear.addEventListener('click', () => {
  apiCall('scrape/clear');
  allResults = [];
  selectedIds.clear();
  renderTable();
  resetStats();
});

// ── Socket.IO Event Handlers ──

function appendLog(entry) {
  if (firstLog) {
    els.logContainer.innerHTML = '';
    firstLog = false;
  }
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.type || 'info'}`;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escapeHtml(entry.message)}</span>`;
  els.logContainer.appendChild(div);
  els.logContainer.scrollTop = els.logContainer.scrollHeight;
  while (els.logContainer.children.length > 500) {
    els.logContainer.removeChild(els.logContainer.firstChild);
  }
}

// Live logs
socket.on('log', (entry) => appendLog(entry));

// Replay buffered logs on connect
socket.on('log_buffer', (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return;
  els.logContainer.innerHTML = '';
  entries.forEach(appendLog);
  firstLog = false;
});

socket.on('connect_error', () => {
  if (connectionErrorShown) return;
  connectionErrorShown = true;
  appendLog({
    message: 'Socket connection failed. Make sure the backend is running on http://localhost:3000.',
    type: 'error',
    timestamp: new Date().toISOString()
  });
});

// Stats update
socket.on('stats', (stats) => {
  animateCounter('statEmails', stats.totalEmails || 0);
  animateCounter('statProcessed', stats.websitesProcessed || 0);
  animateCounter('statQueue', stats.queueRemaining || 0);
  animateCounter('statFailed', stats.failedAttempts || 0);
  $('#statSpeed').textContent = stats.processingSpeed || '0';

  if (stats.timeElapsed) {
    const mins = Math.floor(stats.timeElapsed / 60);
    const secs = Math.floor(stats.timeElapsed % 60);
    $('#statTime').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Progress
  let done = stats.websitesProcessed || 0;
  let total = done + (stats.queueRemaining || 0);
  if (stats.status === 'searching' && stats.searchPagesTotal) {
    done = stats.searchPagesProcessed || 0;
    total = stats.searchPagesTotal || 0;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  els.progressFill.style.width = pct + '%';
  els.progressText.textContent = pct + '%';

  // Status badge
  const status = stats.status || 'idle';
  updateStatusBadge(status);
  setButtonStates(status);
});

// New email result
socket.on('result', (result) => {
  allResults.push(result);
  els.resultCount.textContent = `(${allResults.length})`;
  addTableRow(result);
});

// Existing results on reconnect
socket.on('existing_results', (results) => {
  allResults = results;
  els.resultCount.textContent = `(${allResults.length})`;
  renderTable();
});

// Clear
socket.on('clear', () => {
  allResults = [];
  selectedIds.clear();
  els.resultCount.textContent = '(0)';
  renderTable();
});

// CAPTCHA alert
socket.on('captcha', (alert) => {
  els.captchaMessage.textContent = alert.message || 'Scraping paused due to verification.';
  els.captchaModal.classList.add('active');
});

// ── CAPTCHA Modal ──
$('#btnModalResume').addEventListener('click', () => {
  els.captchaModal.classList.remove('active');
  apiCall('scrape/resume');
});
$('#btnModalDismiss').addEventListener('click', () => {
  els.captchaModal.classList.remove('active');
});

// ── Animated Counter ──
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const increment = diff / steps;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    el.textContent = Math.round(current + increment * step);
    if (step >= steps) {
      el.textContent = target;
      clearInterval(timer);
    }
  }, 30);
}

// ── Status Badge ──
function updateStatusBadge(status) {
  const labels = {
    idle: 'Idle', searching: 'Searching...', scraping: 'Scraping...',
    paused: 'Paused', stopped: 'Stopped', cooldown: 'Cooling Down...', completed: 'Completed'
  };
  els.statusBadge.className = `status-badge status-${status}`;
  els.statusBadge.innerHTML = `<span class="status-dot"></span> ${labels[status] || status}`;
}

// ── Reset Stats ──
function resetStats() {
  ['statEmails', 'statProcessed', 'statQueue', 'statFailed'].forEach(id => {
    document.getElementById(id).textContent = '0';
  });
  $('#statSpeed').textContent = '0';
  $('#statTime').textContent = '0:00';
  els.progressFill.style.width = '0%';
  els.progressText.textContent = '0%';
  updateStatusBadge('idle');
  els.logContainer.innerHTML = '<div class="log-empty">Logs will appear here when scraping starts...</div>';
  firstLog = true;
}

// ── Results Table ──
function renderTable() {
  const search = els.tableSearch.value.toLowerCase();
  const filtered = allResults.filter(r =>
    r.email.toLowerCase().includes(search) ||
    r.company.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    els.resultsBody.innerHTML = `<tr><td colspan="6" class="empty-table"><div class="empty-icon">📭</div><div>No emails found yet. Start scraping to see results.</div></td></tr>`;
    return;
  }

  els.resultsBody.innerHTML = filtered.map(r => buildRowHtml(r)).join('');
  attachRowListeners();
}

function addTableRow(result) {
  // Remove empty state if present
  const empty = els.resultsBody.querySelector('.empty-table');
  if (empty) empty.closest('tr').remove();

  const tr = document.createElement('tr');
  tr.innerHTML = buildRowHtml(result);
  // Unwrap: insertAdjacentHTML is cleaner
  els.resultsBody.insertAdjacentHTML('afterbegin', buildRowHtml(result));
  attachRowListeners();
}

function buildRowHtml(r) {
  const checked = selectedIds.has(r.id) ? 'checked' : '';
  const selected = selectedIds.has(r.id) ? 'selected' : '';
  const statusClass = r.status === 'Business' ? 'badge-business' : 'badge-general';
  const sourceClass = r.source === 'HTTP' ? 'badge-http' : 'badge-browser';
  return `<tr class="${selected}" data-id="${r.id}">
    <td><input type="checkbox" class="select-cb row-cb" data-id="${r.id}" ${checked}></td>
    <td class="email-cell">${escapeHtml(r.email)}</td>
    <td class="company-cell">${escapeHtml(r.company)}</td>
    <td><span class="badge ${sourceClass}">${r.source}</span></td>
    <td><span class="badge ${statusClass}">${r.status}</span></td>
    <td><div class="row-actions">
      <button class="row-btn copy-btn" data-email="${escapeHtml(r.email)}" title="Copy email">📋</button>
      <button class="row-btn delete row-del" data-id="${r.id}" title="Delete">✕</button>
    </div></td>
  </tr>`;
}

function attachRowListeners() {
  // Copy buttons
  $$('.copy-btn').forEach(btn => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.dataset.email);
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '📋', 1200);
    };
  });
  // Delete buttons
  $$('.row-del').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      await apiCall(`results/${id}`, 'DELETE');
      allResults = allResults.filter(r => r.id !== id);
      selectedIds.delete(id);
      els.resultCount.textContent = `(${allResults.length})`;
      renderTable();
    };
  });
  // Row checkboxes
  $$('.row-cb').forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      els.btnBulkDelete.disabled = selectedIds.size === 0;
      cb.closest('tr').classList.toggle('selected', cb.checked);
    };
  });
}

// Table search
els.tableSearch.addEventListener('input', renderTable);

// Select all
els.selectAllCb.addEventListener('change', () => {
  const checked = els.selectAllCb.checked;
  if (checked) allResults.forEach(r => selectedIds.add(r.id));
  else selectedIds.clear();
  els.btnBulkDelete.disabled = selectedIds.size === 0;
  renderTable();
});
els.btnSelectAll.addEventListener('click', () => {
  els.selectAllCb.checked = !els.selectAllCb.checked;
  els.selectAllCb.dispatchEvent(new Event('change'));
});

// Bulk delete
els.btnBulkDelete.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  await apiCall('results/bulk-delete', 'POST', { ids: Array.from(selectedIds) });
  allResults = allResults.filter(r => !selectedIds.has(r.id));
  selectedIds.clear();
  els.resultCount.textContent = `(${allResults.length})`;
  els.btnBulkDelete.disabled = true;
  renderTable();
});

// ── Export Buttons ──
$('#btnCSV').addEventListener('click', () => downloadFile('/api/export/csv?mode=full'));
$('#btnXLSX').addEventListener('click', () => downloadFile('/api/export/xlsx?mode=full'));
$('#btnCSVEmail').addEventListener('click', () => downloadFile('/api/export/csv?mode=email'));
$('#btnXLSXEmail').addEventListener('click', () => downloadFile('/api/export/xlsx?mode=email'));
$('#btnCopyAll').addEventListener('click', () => {
  const emails = allResults.map(r => r.email).join('\n');
  navigator.clipboard.writeText(emails).then(() => {
    const btn = $('#btnCopyAll');
    btn.innerHTML = '<span class="btn-text">✅ Copied!</span>';
    setTimeout(() => btn.innerHTML = '<span class="btn-text">📋 Copy All Emails</span>', 2000);
  });
});

function downloadFile(url) {
  const a = document.createElement('a');
  const fullUrl = API_BASE ? `${API_BASE}${url}` : url;
  a.href = fullUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Utility ──
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Keyboard Shortcut ──
els.keyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !els.btnStart.disabled) els.btnStart.click();
});
