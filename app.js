// Shorthand query helper
const $ = (s) => document.querySelector(s);

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let PROVIDERS = null, METRICS = null, CURRENT_WINDOW = 'last_24h';
let modalChart = null; // track modal chart instance to dispose on reopen

// ═══════════════════════════════════════════════════════════════
// THEME SYSTEM
// ═══════════════════════════════════════════════════════════════
const THEME_KEY = 'tfstats-theme';
const VALID_THEMES = ['dark', 'light', 'colorful'];

function applyTheme(theme) {
  if (!VALID_THEMES.includes(theme)) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  document.querySelectorAll('[data-theme-target]').forEach(btn => {
    const active = btn.dataset.themeTarget === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Rebuild charts with new palette colours if data is already loaded
  if (PROVIDERS && METRICS) syncWindowUI();
}

// Restore persisted theme immediately (before data loads) to avoid flash
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

// Wire theme-toggle buttons (also re-wired in boot for safety, idempotent via addEventListener)
document.querySelectorAll('[data-theme-target]').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeTarget));
});

// ═══════════════════════════════════════════════════════════════
// CHART INIT  (kept 'dark' echarts theme for all modes — we
// override all axis/label colours manually anyway)
// ═══════════════════════════════════════════════════════════════
const charts = {
  top:    echarts.init(document.getElementById('chartTop'),    'dark'),
  movers: echarts.init(document.getElementById('chartMovers'), 'dark'),
};

// ═══════════════════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════
function fmt(n) {
  if (n == null) return '—';
  const x = Number(n);
  if (x >= 1_000_000_000) return (x / 1_000_000_000).toFixed(2) + 'B';
  if (x >= 1_000_000)     return (x / 1_000_000).toFixed(2) + 'M';
  if (x >= 1_000)         return (x / 1_000).toFixed(1) + 'k';
  return String(x);
}

const linkify = (src) =>
  src
    ? `<a href="${src}" target="_blank" rel="noopener"
          class="text-green-500 hover:text-green-400 transition">source</a>`
    : '—';

// Accent palette per theme
function colorAccent(i = 0) {
  const theme = document.documentElement.getAttribute('data-theme');
  const palettes = {
    dark:     ['#45ffbc', '#10b981', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899'],
    light:    ['#059669', '#2563eb', '#0284c7', '#7c3aed', '#d97706', '#db2777'],
    colorful: ['#a78bfa', '#818cf8', '#60a5fa', '#c084fc', '#f472b6', '#34d399'],
  };
  return (palettes[theme] || palettes.dark)[i % 6];
}

// Chart axis/line/tooltip colours per theme
function chartTokens() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return {
      label:        '#64748b',
      axis:         '#e2e8f0',
      split:        '#e2e8f0',
      tooltipBg:    'rgba(255,255,255,0.97)',
      tooltipBorder:'#e2e8f0',
      tooltipText:  '#0f172a',
      barBg:        '#f1f5f9',
    };
  }
  if (theme === 'colorful') {
    return {
      label:        '#a78bfa',
      axis:         '#3b2f6e',
      split:        '#2f255a',
      tooltipBg:    'rgba(26,21,53,0.96)',
      tooltipBorder:'#7c3aed',
      tooltipText:  '#f0e6ff',
      barBg:        '#251d4a',
    };
  }
  // dark (default)
  return {
    label:        '#969593',
    axis:         '#313131',
    split:        '#2e2e2e',
    tooltipBg:    'rgba(30,30,30,0.93)',
    tooltipBorder:'#45ffbc',
    tooltipText:  '#f1f1f1',
    barBg:        '#2e2e2e',
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════
async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}

const pickWindowData = (key) =>
  METRICS?.windows?.[key]?.available ? METRICS.windows[key] : null;

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATION  (replaces blocking alert)
// ═══════════════════════════════════════════════════════════════
let _toastTimer = null;
function showToast(msg, type = 'error') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type === 'error' ? 'toast-error' : 'toast-ok';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
}

// ═══════════════════════════════════════════════════════════════
// KPI CARDS
// ═══════════════════════════════════════════════════════════════
function computeKpis() {
  const list = PROVIDERS.providers;
  const total = list.reduce((s, p) => s + Number(p.totalDownloads || 0), 0);
  const tc    = (t) => list.filter(p => p.tier === t).length;
  const w     = pickWindowData(CURRENT_WINDOW);

  $('#kpiProviders').textContent  = list.length.toLocaleString();
  $('#kpiDownloads').textContent  = fmt(total);
  $('#kpiTierSplit').textContent  = `${tc('official')} / ${tc('partner')} / ${tc('community')}`;
  $('#kpiDate').textContent       = `as of ${PROVIDERS.date}`;
  $('#headerDate').textContent    = PROVIDERS.date;
  $('#kpiWindow').textContent     = w ? `ref ${w.refDate}` : 'no history';
  $('#kpiMovers').textContent     = w ? (w.moversUp.length + w.moversDown.length) : '0';
}

// ═══════════════════════════════════════════════════════════════
// FEATURED / STARRED PROVIDER (IBM-Cloud/ibm)
// ═══════════════════════════════════════════════════════════════
function updateStarredProvider() {
  const ibm = PROVIDERS.providers.find(p => p.fullName === 'IBM-Cloud/ibm');
  if (!ibm) { $('#starredProvider').style.display = 'none'; return; }

  const w      = pickWindowData(CURRENT_WINDOW);
  const sorted = PROVIDERS.providers.slice().sort((a, b) => b.totalDownloads - a.totalDownloads);
  const rankNow = sorted.findIndex(x => x.fullName === ibm.fullName) + 1;
  const pd      = w ? (w.top.find(x => x.fullName === ibm.fullName)?.periodDownloads ?? 0) : 0;
  const moverEntry = w ? w.moversUp.concat(w.moversDown).find(x => x.fullName === ibm.fullName) : null;
  const delta   = moverEntry && rankNow ? moverEntry.before - rankNow : 0;

  $('#starredTier').textContent      = ibm.tier;
  $('#starredDownloads').textContent = fmt(ibm.totalDownloads);
  $('#starredRank').textContent      = rankNow || '—';
  $('#starredPeriod').textContent    = w ? fmt(pd) : '—';

  const el = $('#starredDelta');
  if (delta > 0) {
    el.className  = 'text-lg font-bold text-green-500';
    el.textContent = `▲ ${delta}`;
  } else if (delta < 0) {
    el.className  = 'text-lg font-bold text-red-500';
    el.textContent = `▼ ${Math.abs(delta)}`;
  } else {
    el.className  = 'text-lg font-bold text-gray-400';
    el.textContent = '—';
  }

  $('#starredProvider').style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════
function buildTopChart(rows) {
  const topN  = rows.slice(0, 12);
  const names = topN.map(r => r.fullName);
  const vals  = topN.map(r => r.periodDownloads);
  const t     = chartTokens();

  charts.top.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: t.tooltipBg,
      borderColor:     t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (p) =>
        `<strong>${p[0].name}</strong><br/>Downloads: <b>${fmt(p[0].value)}</b>`,
    },
    grid: { left: 8, right: 16, bottom: 10, top: 16, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: fmt, color: t.label, fontSize: 11 },
      axisLine:  { lineStyle: { color: t.axis } },
      splitLine: { lineStyle: { color: t.split } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: t.label, fontSize: 11 },
      axisLine:  { lineStyle: { color: t.axis } },
    },
    series: [{
      type: 'bar',
      data: vals.map((v, i) => ({
        value: v,
        itemStyle: { color: colorAccent(i), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 22,
      showBackground: true,
      backgroundStyle: { color: t.barBg, borderRadius: [0, 3, 3, 0] },
    }],
  });
}

function buildMoversChart(moversUp, moversDown) {
  const up    = moversUp.slice(0, 8);
  const down  = moversDown.slice(0, 8);
  const names = [...up.map(x => x.fullName), ...down.map(x => x.fullName)];
  const deltas = [...up.map(x => x.change), ...down.map(x => -x.change)];
  const t     = chartTokens();

  const theme   = document.documentElement.getAttribute('data-theme');
  const upColor   = theme === 'colorful' ? '#a78bfa' : theme === 'light' ? '#059669' : '#45ffbc';
  const downColor = theme === 'colorful' ? '#fb7185' : '#dc2626';

  charts.movers.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: t.tooltipBg,
      borderColor:     t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (p) => {
        const a = p[0], dir = a.value >= 0 ? '▲' : '▼';
        return `<strong>${a.name}</strong><br/>Rank change: <b>${dir} ${Math.abs(a.value)}</b>`;
      },
    },
    grid: { left: 8, right: 16, bottom: 10, top: 16, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => (v >= 0 ? '+' : '−') + Math.abs(v),
        color: t.label, fontSize: 11,
      },
      axisLine:  { lineStyle: { color: t.axis } },
      splitLine: { lineStyle: { color: t.split } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: t.label, fontSize: 11 },
      axisLine:  { lineStyle: { color: t.axis } },
    },
    series: [{
      type: 'bar',
      data: deltas.map((v, i) => ({
        value: v,
        itemStyle: {
          color: i < up.length ? upColor : downColor,
          borderRadius: v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
        },
      })),
      barMaxWidth: 22,
      showBackground: true,
      backgroundStyle: { color: t.barBg },
    }],
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER CATALOG TABLE
// ═══════════════════════════════════════════════════════════════
function rebuildTable(windowKey) {
  const tbody  = document.getElementById('tableBody');
  const w      = pickWindowData(windowKey);
  const q      = ($('#searchBox').value || '').toLowerCase().trim();

  // Rank all providers by total downloads
  const rankNow = new Map();
  PROVIDERS.providers
    .slice()
    .sort((a, b) => b.totalDownloads - a.totalDownloads)
    .forEach((p, i) => rankNow.set(p.fullName, i + 1));

  let rows = PROVIDERS.providers.map((p, i) => {
    const pd     = w ? (w.top.find(x => x.fullName === p.fullName)?.periodDownloads ?? 0) : 0;
    const mover  = w && w.moversUp.concat(w.moversDown).find(x => x.fullName === p.fullName);
    const now    = rankNow.get(p.fullName);
    const delta  = (mover?.before && now) ? mover.before - now : 0;
    return { idx: i + 1, ...p, periodDownloads: pd, delta, rankNow: now };
  });

  if (q) rows = rows.filter(r => r.fullName.toLowerCase().includes(q));

  const emptyState   = document.getElementById('emptyState');
  const tableWrapper = document.getElementById('tableWrapper');

  if (rows.length === 0) {
    tableWrapper.style.display = 'none';
    emptyState.classList.remove('hidden');
    $('#catalogCountTag').textContent = '0 results';
    return;
  }

  tableWrapper.style.display = '';
  emptyState.classList.add('hidden');
  $('#catalogCountTag').textContent = `${rows.length.toLocaleString()} shown`;
  $('#thPeriod').textContent = w
    ? `Downloads (${windowKey.replace('last_', '')})`
    : 'Period Downloads';

  const frag = document.createDocumentFragment();
  rows.slice(0, 1000).forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-700 cursor-pointer';

    const deltaColor = r.delta > 0 ? 'text-green-500' : r.delta < 0 ? 'text-red-500' : 'text-gray-500';
    const deltaText  = r.delta === 0
      ? '<span class="text-gray-500">—</span>'
      : r.delta > 0 ? `▲ ${r.delta}` : `▼ ${Math.abs(r.delta)}`;

    const tierBadge = `<span class="inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
      r.tier === 'official'
        ? 'bg-green-500 bg-opacity-15 text-green-500 border border-green-500 border-opacity-50'
        : r.tier === 'partner'
        ? 'bg-blue-500 bg-opacity-15 text-blue-400 border border-blue-500 border-opacity-50'
        : 'bg-gray-600 bg-opacity-60 text-gray-300 border border-gray-500 border-opacity-40'
    }">${r.tier}</span>`;

    tr.innerHTML = `
      <td class="px-4 py-3 text-gray-500 text-xs tabular-nums">${i + 1}</td>
      <td class="px-4 py-3">
        <button class="linklike text-green-500 hover:text-green-400 font-semibold text-left hover:underline underline-offset-2 transition focus:outline-none"
                data-name="${r.fullName}">${r.fullName}</button>
      </td>
      <td class="px-4 py-3">${tierBadge}</td>
      <td class="px-4 py-3 text-gray-300 tabular-nums">${fmt(r.totalDownloads)}</td>
      <td class="px-4 py-3 text-gray-300 tabular-nums">${w ? fmt(r.periodDownloads) : '—'}</td>
      <td class="px-4 py-3 ${deltaColor} font-semibold tabular-nums text-sm">${deltaText}</td>
      <td class="px-4 py-3">${linkify(r.source)}</td>`;

    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);

  // Bind row click handlers
  tbody.querySelectorAll('button.linklike').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(btn.dataset.name);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER DETAIL MODAL
// ═══════════════════════════════════════════════════════════════
window.openModal = function(fullName) {
  const p = PROVIDERS.providers.find(x => x.fullName === fullName);
  if (!p) return;

  const w   = pickWindowData(CURRENT_WINDOW) || { top: [], moversUp: [], moversDown: [] };
  const pd  = w.top?.find(x => x.fullName === fullName)?.periodDownloads ?? 0;

  $('#modalTitle').textContent     = p.fullName;
  $('#modalTier').textContent      = p.tier;
  $('#modalRegistry').href         = `https://registry.terraform.io/providers/${p.fullName}`;
  $('#modalDesc').textContent      = p.description || 'No description available.';
  $('#mTotal').textContent         = fmt(p.totalDownloads);

  // Source link
  $('#modalSource').href           = p.source || '#';
  $('#modalSource').style.display  = p.source ? 'inline-flex' : 'none';

  // Rank + delta
  const sorted  = PROVIDERS.providers.slice().sort((a, b) => b.totalDownloads - a.totalDownloads);
  const rankNow = sorted.findIndex(x => x.fullName === p.fullName) + 1;
  const mover   = w.moversUp?.concat(w.moversDown ?? []).find(x => x.fullName === fullName);
  const delta   = (mover?.before && rankNow) ? mover.before - rankNow : 0;

  $('#mRankNow').textContent = rankNow || '—';
  const dcls = delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  $('#mRankDelta').className  = `text-xl font-bold tabular-nums ${dcls}`;
  $('#mRankDelta').textContent = delta === 0 ? '—' : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
  $('#mPeriod').textContent   = w?.available ? fmt(pd) : '—';

  // Mini bar chart — dispose old instance to prevent memory leak
  if (modalChart) { modalChart.dispose(); modalChart = null; }

  const t      = chartTokens();
  const labels = ['last_24h', 'last_7d', 'last_30d', 'last_365d'];
  const xLabels = ['24h', '7d', '30d', '365d'];
  const series = labels.map(key => {
    const ww = pickWindowData(key);
    return ww?.top ? (ww.top.find(x => x.fullName === fullName)?.periodDownloads ?? 0) : 0;
  });

  modalChart = echarts.init(document.getElementById('modalChart'), 'dark');
  modalChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor:     t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.tooltipText, fontSize: 12 },
    },
    grid: { left: 8, right: 8, top: 10, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLabel: { color: t.label, fontSize: 12 },
      axisLine:  { lineStyle: { color: t.axis } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: fmt, color: t.label, fontSize: 11 },
      axisLine:  { lineStyle: { color: t.axis } },
      splitLine: { lineStyle: { color: t.split } },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 40,
      data: series.map((v, i) => ({
        value: v,
        itemStyle: { color: colorAccent(i), borderRadius: [3, 3, 0, 0] },
      })),
    }],
  });

  // Show modal with animation
  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  // Trigger animation on next frame
  requestAnimationFrame(() => modal.classList.add('open'));

  // Trap focus on close button for keyboard accessibility
  setTimeout(() => document.getElementById('modalClose')?.focus(), 60);
};

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  // Wait for fade-out before hiding
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 220);
}

// ═══════════════════════════════════════════════════════════════
// SCROLL-TO-TOP BUTTON
// ═══════════════════════════════════════════════════════════════
const scrollTopBtn = document.getElementById('scrollTop');
window.addEventListener('scroll', () => {
  scrollTopBtn.classList.toggle('visible', window.scrollY > 450);
}, { passive: true });
scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ═══════════════════════════════════════════════════════════════
// SYNC WINDOW UI  (called on time-window change or theme change)
// ═══════════════════════════════════════════════════════════════
function syncWindowUI() {
  const w = pickWindowData(CURRENT_WINDOW);
  const ref = w?.refDate ? `ref: ${w.refDate}` : 'ref: N/A';
  document.getElementById('refDateTag').textContent = ref;

  if (w?.top) {
    buildTopChart(w.top);
    buildMoversChart(w.moversUp || [], w.moversDown || []);
    document.getElementById('topCountTag').textContent = `${w.top.length} items`;
  } else {
    charts.top.clear();
    charts.movers.clear();
    document.getElementById('topCountTag').textContent = '0 items';
  }

  computeKpis();
  updateStarredProvider();
  rebuildTable(CURRENT_WINDOW);
}

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
async function boot() {
  try {
    // Load providers (min.json first, fallback to full)
    try {
      PROVIDERS = await loadJSON('./data/providers-latest.min.json');
    } catch (_) {
      PROVIDERS = await loadJSON('./data/providers-latest.json');
    }

    // Load metrics (min.json first, fallback to full)
    try {
      METRICS = await loadJSON('./data/metrics-latest.min.json');
    } catch (_) {
      METRICS = await loadJSON('./data/metrics-latest.json');
    }

    // ── Event Listeners ──
    document.getElementById('windowSelect').addEventListener('change', (e) => {
      CURRENT_WINDOW = e.target.value;
      syncWindowUI();
    });

    // Debounced search for performance
    document.getElementById('searchBox').addEventListener(
      'input',
      debounce(() => rebuildTable(CURRENT_WINDOW), 200)
    );

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('modal').classList.contains('hidden')) {
        closeModal();
      }
    });

    // Responsive chart resize
    window.addEventListener('resize', () => {
      charts.top.resize();
      charts.movers.resize();
    }, { passive: true });

    // Initial render
    computeKpis();
    syncWindowUI();

  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('Failed to load data. Ensure data files exist in ./data/ directory.', 'error');
  }
}

// Start
boot();