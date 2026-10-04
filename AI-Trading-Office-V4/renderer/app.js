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

const el = (id) => document.getElementById(id);
const panels = {};     // id -> { root, badge, fields: {key: valueEl} }
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
      ${a.hub ? '<div class="hub-glow"></div>' : ''}`;

    grid.appendChild(root);
    const fields = {};
    root.querySelectorAll('.v').forEach(v => { fields[v.dataset.k] = v; });
    panels[a.id] = { root, badge: root.querySelector('[data-badge]'), fields };
  }
  requestAnimationFrame(drawLinks);
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
  }
  applyLinkStates(w);
  if (w.log && w.log.length) pushFeed(w.log);
  if (w.summary) el('summary').textContent =
    `${w.summary.connected} агентов подключены · ${w.summary.working} в работе`;
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

// ---------- clock ----------
function tickClock() {
  const d = new Date();
  el('clock').textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  buildPanels();
  el('btn-settings').addEventListener('click', openSettings);
  el('btn-cancel').addEventListener('click', closeSettings);
  el('btn-save').addEventListener('click', saveSettings);
  window.addEventListener('resize', () => requestAnimationFrame(drawLinks));
  tickClock(); setInterval(tickClock, 1000);
  wireBridge();
});
