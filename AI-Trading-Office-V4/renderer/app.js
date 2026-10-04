'use strict';
/* AI Trading Office — renderer (the BODY). Pure view over world-state snapshots.
 * It never invents agent state: DEMO snapshots come from the Simulator, LIVE ones
 * from the core via mapBackendToWorld. The header always says which. */

const { AGENTS, STATUS, Simulator, mapBackendToWorld } = window.OFFICE;

// Grid placement (3x3); master is the central hub, bottom-center stays for the globe.
const LAYOUT = {
  market:    { c: 1, r: 1 }, liquidity: { c: 2, r: 1 }, strategy:  { c: 3, r: 1 },
  entry:     { c: 1, r: 2 }, master:    { c: 2, r: 2 }, exit:      { c: 3, r: 2 },
  risk:      { c: 1, r: 3 }, execution: { c: 3, r: 3 }
};

// which numeric metric each panel trends as a sparkline
const SPARK = { market: 'score', liquidity: 'roi', entry: 'confidence', master: 'confidence', risk: 'total' };
const ACCENT_HEX = { cyan: '#36d0ff', gold: '#ffcf5a', violet: '#b58bff' };
const history = {};    // id -> [numbers]

const el = (id) => document.getElementById(id);
const panels = {};     // id -> { root, badge, fields, spark }
const lines = {};      // id -> <line>
let world = null;
let sim = null;
let simTimer = null;
let live = false;

// ---------- build panels ----------
function buildPanels() {
  const grid = el('agents-grid');
  grid.innerHTML = '';
  for (const a of AGENTS) {
    const pos = LAYOUT[a.id];
    const root = document.createElement('div');
    root.className = `panel accent-${a.accent}` + (a.hub ? ' hub' : '');
    root.style.gridColumn = pos.c;
    root.style.gridRow = pos.r;
    root.dataset.id = a.id;

    const rows = a.fields.map(([label, key]) =>
      `<div class="kv"><span class="k">${label}</span><span class="v" data-k="${key}">—</span></div>`
    ).join('');

    root.innerHTML = `
      <div class="panel-head">
        <div class="panel-titles">
          <div class="panel-name">${a.name}</div>
          <div class="panel-sub">${a.sub}</div>
        </div>
        <div class="badge" data-badge>—</div>
      </div>
      <div class="panel-body">${rows}</div>
      ${SPARK[a.id] ? '<canvas class="spark" width="300" height="60"></canvas>' : ''}
      ${a.hub ? '<div class="hub-glow"></div>' : ''}`;

    grid.appendChild(root);
    const fields = {};
    root.querySelectorAll('.v').forEach(v => { fields[v.dataset.k] = v; });
    panels[a.id] = { root, badge: root.querySelector('[data-badge]'), fields, spark: root.querySelector('.spark') };
    history[a.id] = [];
    root.addEventListener('click', () => { if (window.Office) window.Office.select(a.id); });
  }

  // P&L / session-summary tile in the free bottom-center cell
  const pnl = document.createElement('div');
  pnl.className = 'panel pnl accent-cyan';
  pnl.style.gridColumn = 2; pnl.style.gridRow = 3;
  pnl.innerHTML = `
    <div class="panel-head"><div class="panel-titles">
      <div class="panel-name">ИТОГ СЕССИИ</div><div class="panel-sub">Сделки и P&amp;L</div></div></div>
    <div class="panel-body">
      <div class="kv"><span class="k">Сделок</span><span class="v" id="pnl-trades">0</span></div>
      <div class="kv"><span class="k">Winrate</span><span class="v" id="pnl-wr">—</span></div>
      <div class="kv"><span class="k">P&amp;L сессии</span><span class="v" id="pnl-val">0 $</span></div>
    </div>
    <canvas class="spark" id="pnl-spark" width="300" height="60"></canvas>`;
  el('agents-grid').appendChild(pnl);
  history.pnl = [];

  requestAnimationFrame(drawLinks);
}

function highlightPanel(id) { for (const k in panels) panels[k].root.classList.toggle('selected', k === id); }

function renderPositions(list) {
  const ul = el('pos-list'); if (!ul) return;
  if (!list.length) { ul.innerHTML = '<li class="pos-empty">Нет открытых позиций</li>'; return; }
  ul.innerHTML = list.map(p => {
    const buy = p.side === 'BUY', pnl = p.pnl || 0;
    return `<li class="pos-item"><span class="pos-sym">${p.symbol}</span>` +
      `<span class="pos-side ${buy ? 'buy' : 'sell'}">${buy ? '▲ BUY' : '▼ SELL'}</span>` +
      `<span class="pos-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)} $</span></li>`;
  }).join('');
}

// ---------- connection lines (hub -> each agent) ----------
function drawLinks() {
  const svg = el('links');
  const stage = svg.parentElement.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${stage.width} ${stage.height}`);
  svg.innerHTML = '';
  const center = (node) => {
    const r = node.getBoundingClientRect();
    return { x: r.left - stage.left + r.width / 2, y: r.top - stage.top + r.height / 2 };
  };
  const hub = center(panels.master.root);
  for (const a of AGENTS) {
    if (a.hub) continue;
    const p = center(panels[a.id].root);
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', hub.x); ln.setAttribute('y1', hub.y);
    ln.setAttribute('x2', p.x);   ln.setAttribute('y2', p.y);
    ln.setAttribute('class', 'link');
    svg.appendChild(ln);
    lines[a.id] = ln;
  }
  if (world) applyLinkStates(world);
}

function applyLinkStates(w) {
  for (const a of AGENTS) {
    if (a.hub || !lines[a.id]) continue;
    const st = (w.agents[a.id] || {}).status;
    lines[a.id].classList.toggle('active', st === 'working');
    lines[a.id].classList.toggle('blocked', st === 'blocked');
  }
}

// ---------- render a snapshot ----------
function render(w) {
  world = w;
  for (const a of AGENTS) {
    const pdata = panels[a.id];
    const s = w.agents[a.id] || { status: 'idle', metrics: {} };
    const st = STATUS[s.status] || STATUS.idle;
    pdata.badge.textContent = st.label;
    pdata.badge.className = `badge ${st.cls}`;
    pdata.root.classList.toggle('is-working', s.status === 'working');
    pdata.root.classList.toggle('is-blocked', s.status === 'blocked');
    for (const [, key] of a.fields) {
      const v = s.metrics ? s.metrics[key] : undefined;
      if (pdata.fields[key]) pdata.fields[key].textContent = (v == null || v === '') ? '—' : v;
    }
    // sparkline trend
    if (pdata.spark && SPARK[a.id]) {
      const n = parseNum(s.metrics ? s.metrics[SPARK[a.id]] : null);
      if (n != null) { const h = history[a.id]; h.push(n); if (h.length > 40) h.shift(); drawSpark(pdata.spark, h, ACCENT_HEX[a.accent] || '#36d0ff'); }
    }
  }
  applyLinkStates(w);
  if (window.Office) window.Office.update(w);   // feed the pixel-floor view too
  if (w.log && w.log.length) pushFeed(w.log);
  if (w.summary) el('summary').textContent =
    `${w.summary.connected} агентов подключены · ${w.summary.working} в работе`;
  // P&L tile
  if (w.summary && el('pnl-val')) {
    el('pnl-trades').textContent = w.summary.trades ?? 0;
    el('pnl-wr').textContent = w.summary.winrate != null ? w.summary.winrate + '%' : '—';
    const v = w.summary.pnl ?? 0, pv = el('pnl-val');
    pv.textContent = (v >= 0 ? '+' : '') + v.toFixed(0) + ' $';
    pv.style.color = v >= 0 ? 'var(--green)' : 'var(--red)';
    if (history.pnl) { history.pnl.push(v); if (history.pnl.length > 60) history.pnl.shift(); drawSpark(el('pnl-spark'), history.pnl, v >= 0 ? '#36e39a' : '#ff5d6c'); }
  }
  // trading panel: equity curve + open positions
  if (w.summary && el('equity-val')) {
    const eq = w.summary.equity ?? 1000;
    el('equity-val').textContent = Math.round(eq) + ' $'; el('equity-val').style.color = eq >= 1000 ? 'var(--green)' : 'var(--red)';
    const f = w.summary.floating ?? 0, fe = el('equity-float');
    if (fe) { fe.textContent = 'Плавающий: ' + (f >= 0 ? '+' : '') + f.toFixed(0) + ' $'; fe.style.color = f >= 0 ? 'var(--green)' : 'var(--red)'; }
    if (!history.equity) history.equity = [];
    history.equity.push(eq); if (history.equity.length > 80) history.equity.shift();
    if (el('equity-chart')) drawSpark(el('equity-chart'), history.equity, eq >= 1000 ? '#36e39a' : '#ff5d6c');
    renderPositions(w.summary.positions || []);
  }
  // header mode
  const modeBadge = el('mode-badge');
  modeBadge.textContent = w.mode === 'live' ? 'LIVE' : 'DEMO';
  modeBadge.className = 'mode-badge ' + (w.mode === 'live' ? 'live' : 'demo');
}

// ---------- activity feed ----------
const feedMax = 60;
function pushFeed(items) {
  const list = el('feed-list');
  for (const it of items) {
    const li = document.createElement('li');
    li.className = `feed-item ${it.kind || 'info'}`;
    li.innerHTML = `<span class="t">${it.ts || ''}</span><span class="m">${escapeHtml(it.text)}</span>`;
    list.prepend(li);
  }
  while (list.children.length > feedMax) list.removeChild(list.lastChild);
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ---------- sparklines ----------
function parseNum(v) { if (v == null) return null; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function drawSpark(cv, data, color) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height; c.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const min = Math.min(...data), max = Math.max(...data), rng = (max - min) || 1;
  const X = i => (i / (data.length - 1)) * (w - 6) + 3;
  const Y = v => h - 5 - ((v - min) / rng) * (h - 12);
  c.beginPath(); c.moveTo(X(0), h); data.forEach((v, i) => c.lineTo(X(i), Y(v))); c.lineTo(X(data.length - 1), h); c.closePath();
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00'); c.fillStyle = g; c.fill();
  c.beginPath(); data.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))); c.strokeStyle = color; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.arc(X(data.length - 1), Y(data[data.length - 1]), 2.6, 0, 7); c.fillStyle = color; c.fill();
}

// ---------- DEMO loop ----------
function startDemo() {
  if (simTimer) return;
  if (!sim) sim = new Simulator();
  render(sim.snapshot());
  simTimer = setInterval(() => { if (!live) render(sim.tick()); }, 1300);
}
function stopDemo() { clearInterval(simTimer); simTimer = null; }

// ---------- connection badge ----------
function setConn(status) {
  const map = {
    connected:      ['live',  'подключено к ядру'],
    connecting:     ['warn',  'подключение…'],
    reconnecting:   ['warn',  'переподключение…'],
    not_configured: ['off',   'не настроено — DEMO'],
    error:          ['bad',   'ошибка соединения'],
    demo:           ['off',   'DEMO (симуляция)']
  };
  const [cls, text] = map[status] || ['off', status];
  const b = el('conn-badge');
  b.className = 'conn-badge ' + cls;
  el('conn-text').textContent = text;
}

// ---------- wire Electron bridge (guarded for plain-browser preview) ----------
function wireBridge() {
  if (!window.office) { setConn('demo'); startDemo(); return; }

  window.office.onStatus((p) => {
    setConn(p.status);
    if (p.status === 'connected') { live = true; stopDemo(); }
    else { live = false; startDemo(); }   // keep the office alive while not connected
  });

  window.office.onMessage((raw) => {
    live = true;
    world = mapBackendToWorld(raw, world);
    render(world);
  });

  window.office.appVersion().then(v => el('version').textContent = 'v' + v).catch(() => {});
  loadSettings();
  startDemo();   // alive immediately; swaps to LIVE as soon as the core connects
}

// ---------- settings modal ----------
async function loadSettings() {
  if (!window.office) return;
  try {
    const c = await window.office.getConfig();
    el('in-url').value = c.backendUrl || '';
    el('in-key').value = '';                       // never echo the key
    el('in-key').placeholder = c.hasKey ? '•••••• (ключ сохранён)' : 'оставьте пустым для DEMO';
    el('in-demo').checked = c.startInDemo !== false;
  } catch {}
}
function openSettings() { el('settings').classList.remove('hidden'); loadSettings(); }
function closeSettings() { el('settings').classList.add('hidden'); }
async function saveSettings() {
  const patch = { backendUrl: el('in-url').value.trim(), startInDemo: el('in-demo').checked };
  const key = el('in-key').value;
  if (key) patch.officeKey = key;                  // only overwrite if typed
  if (window.office) await window.office.saveConfig(patch);
  closeSettings();
}

// ---------- view toggle (HUD <-> pixel floor) ----------
function toggleView() {
  const floor = document.body.classList.toggle('view-floor');
  document.body.classList.toggle('view-hud', !floor);
  el('btn-view').textContent = floor ? '📊 HUD' : '🏢 Зал';
  if (floor && window.Office) window.Office.start();
}

// ---------- clock ----------
function tickClock() {
  const d = new Date();
  el('clock').textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  buildPanels();
  if (window.Office) { window.Office.init(el('floor'), AGENTS); window.Office.start(); window.Office.onSelect(highlightPanel); }
  el('btn-settings').addEventListener('click', openSettings);
  el('btn-cancel').addEventListener('click', closeSettings);
  el('btn-save').addEventListener('click', saveSettings);
  el('btn-view').addEventListener('click', toggleView);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    const show = t.dataset.tab;
    el('pos-list').hidden = show !== 'pos'; el('feed-list').hidden = show !== 'feed';
  }));
  window.addEventListener('resize', () => requestAnimationFrame(drawLinks));
  tickClock(); setInterval(tickClock, 1000);
  wireBridge();
});
