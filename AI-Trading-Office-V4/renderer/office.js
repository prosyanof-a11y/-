'use strict';
/* AI Trading Office — "Зал" (pixel office floor) renderer, detailed edition.
 *
 * Second BODY over the SAME world state (agent-office principle: style is a
 * swappable view). People sit and type at furnished workstations when WORKING,
 * roam to coffee/water/core when WAITING, slump red when BLOCKED, and gather for
 * a STANDUP. A signal pipeline (Рынок→Стратег→Вход→Исполнение) flows across the
 * floor. Movement/animation is presentation derived from honest status. */
(() => {

const SHORT = {
  market: 'Рынок', liquidity: 'Ликв./ROI', strategy: 'Стратег', entry: 'Вход',
  master: 'Мастер', exit: 'Выход', risk: 'Риск', execution: 'Исполн.'
};
const ACCENT = { cyan: '#36d0ff', gold: '#ffcf5a', violet: '#b58bff' };
const SKINS = ['#f3d2b3', '#e8be99', '#d49a6a', '#b97a4e', '#8d5a3c'];
const HAIRS = ['#2a2320', '#4a2f1a', '#6b4423', '#a8761f', '#8a8f99', '#111317'];
// role-based accessories so each specialist reads differently
const ROLE_LOOK = {
  market: { glasses: true }, liquidity: {}, strategy: { glasses: true },
  entry: { headset: true }, master: { tie: true, lead: true }, exit: { headset: true },
  risk: { tie: true }, execution: { headset: true }
};

const W = 1200, H = 760;

const DESKS = {
  market:    { x: 205, y: 275 }, liquidity: { x: 420, y: 275 },
  strategy:  { x: 780, y: 275 }, entry:     { x: 995, y: 275 },
  master:    { x: 600, y: 450, big: true },
  risk:      { x: 205, y: 615 }, execution: { x: 420, y: 615 }, exit: { x: 780, y: 615 }
};
const ROAM = [
  { x: 1095, y: 330, kind: 'coffee' }, { x: 1095, y: 500, kind: 'water' },
  { x: 985,  y: 650, kind: 'meeting' }, { x: 150, y: 450, kind: 'core' },
  { x: 560,  y: 560, kind: 'wander' }, { x: 640, y: 360, kind: 'wander' }
];
const PIPE = ['market', 'strategy', 'entry', 'execution'];
const TABLE = { x: 985, y: 640 };
const WHITEBOARD = { x: 985, y: 552 };
const BROKER = { x: 600, y: 702 };
const SYMB = ['XAUUSD', 'EURUSD', 'BTCUSD', 'US500', 'GBPUSD', 'USDJPY', 'ETHUSD'];
// global-trading map on the video wall
const MAP_NODES = [[0.14, 0.42], [0.3, 0.64], [0.5, 0.34], [0.64, 0.58], [0.82, 0.44], [0.46, 0.72], [0.73, 0.3], [0.22, 0.74]];
const MAP_ARCS = [[0, 2], [2, 4], [1, 5], [3, 6], [0, 7], [5, 3], [2, 6]];

let canvas, ctx, raf = 0, last = 0, dpr = 1;
let ents = {}, agentsDef = null;
let viewScale = 1, viewOx = 0, viewOy = 0, selectedId = null, onSelectCb = null;
let activeSymbols = new Set();
let standup = { active: false, until: 0, nextAt: 0 };
let signals = [], nextSignalAt = 0, lastDecision = '';

const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
function accentFor(id) { const a = agentsDef.find(x => x.id === id); return ACCENT[a ? a.accent : 'cyan'] || ACCENT.cyan; }

function initEntities() {
  ents = {}; const N = agentsDef.length;
  agentsDef.forEach((a, i) => {
    const d = DESKS[a.id] || { x: 600, y: 450 }; const hh = hash(a.id);
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
    ents[a.id] = {
      id: a.id, x: d.x, y: d.y, tx: d.x, ty: d.y, status: 'waiting',
      phase: Math.random() * 10, facing: 1, moving: false,
      roaming: false, dwellUntil: 0, roamKind: null,
      standupSlot: { x: TABLE.x + Math.cos(ang) * 104, y: TABLE.y + Math.sin(ang) * 62 },
      color: accentFor(a.id), skin: SKINS[hh % SKINS.length], hair: HAIRS[(hh >> 3) % HAIRS.length],
      hairStyle: hh % 5, beard: ((hh >> 6) % 4) === 0, look: ROLE_LOOK[a.id] || {},
      brokerRun: { active: false, phase: 'go', until: 0 }, brokerCooldown: 0,
      blinkOffset: (hh % 5000), data: null, gesture: null, gestureUntil: 0
    };
  });
  standup = { active: false, until: 0, nextAt: performance.now() + 20000 };
  signals = []; nextSignalAt = performance.now() + 4000; lastDecision = '';
}

function pickRoam(e) {
  if (Math.random() < 0.28) { const d = DESKS[e.id]; e.tx = d.x; e.ty = d.y; e.roamKind = 'desk'; return; }
  const r = ROAM[Math.floor(Math.random() * ROAM.length)];
  e.tx = r.x; e.ty = r.y; e.roamKind = r.kind;
}

const Office = {
  init(cv, agents) { canvas = cv; ctx = cv.getContext('2d'); agentsDef = agents; initEntities(); cv.addEventListener('click', onClick); cv.style.cursor = 'pointer'; },
  update(world) {
    if (!world || !world.agents) return;
    for (const id in ents) { const s = world.agents[id]; if (s) { ents[id].status = s.status; ents[id].data = s; } }
    const m = world.agents.master && world.agents.master.metrics;
    if (m && m.decision) lastDecision = String(m.decision);
    activeSymbols = new Set((world.summary && world.summary.activeSymbols) || []);
  },
  start() { if (!raf) { last = performance.now(); loop(performance.now()); } },
  stop() { cancelAnimationFrame(raf); raf = 0; },
  forceStandup() { standup.active = true; standup.until = performance.now() + 20000; },
  forceSignal() { signals.push({ t0: performance.now(), dur: 4600, symbol: SYMB[Math.floor(Math.random() * SYMB.length)], side: sideFromDecision() }); },
  forceBrokerRun() { const e = ents.execution; if (e) e.brokerRun = { active: true, phase: 'go', until: 0, symbol: 'XAUUSD', side: 'BUY' }; },
  select(id) { selectedId = (id && ents[id]) ? id : null; if (onSelectCb) onSelectCb(selectedId); },
  onSelect(cb) { onSelectCb = cb; }
};

function resizeIfNeeded() {
  dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return false;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  return true;
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(50, now - last); last = now;
  if (!resizeIfNeeded()) return;
  step(dt, now); draw(now);
}

function manageStandup(now) {
  if (standup.active && now > standup.until) {
    standup.active = false; standup.nextAt = now + 32000 + Math.random() * 28000;
    for (const id in ents) ents[id].roaming = false;
  } else if (!standup.active && now > standup.nextAt) { standup.active = true; standup.until = now + 9000; }
}

function hotPipeline() { return ents.entry.status === 'working' || ents.execution.status === 'working'; }
function sideFromDecision() {
  if (/ПОКУПК|BUY|LONG|БЫЧ/i.test(lastDecision)) return 'BUY';
  if (/ПРОДАЖ|SELL|SHORT|МЕДВЕ/i.test(lastDecision)) return 'SELL';
  return Math.random() > 0.5 ? 'BUY' : 'SELL';
}
function manageSignals(now) {
  if (now > nextSignalAt) {
    if (hotPipeline()) { signals.push({ t0: now, dur: 4200, symbol: SYMB[Math.floor(Math.random() * SYMB.length)], side: sideFromDecision() }); nextSignalAt = now + 5000 + Math.random() * 3500; }
    else nextSignalAt = now + 1800;
  }
  signals = signals.filter(s => {
    if (now - s.t0 >= s.dur) {               // token reached Исполнение → maybe run to broker
      const e = ents.execution;
      if (e.status === 'working' && !e.brokerRun.active && now > e.brokerCooldown) {
        e.brokerRun = { active: true, phase: 'go', until: 0, symbol: s.symbol, side: s.side }; e.brokerCooldown = now + 9000;
      }
      return false;
    }
    return true;
  });
}

function step(dt, now) {
  manageStandup(now); manageSignals(now);
  for (const id in ents) {
    const e = ents[id];
    const br = e.brokerRun;
    if (id === 'execution' && br.active) {
      if (br.phase === 'go') { e.tx = BROKER.x; e.ty = BROKER.y; e.roamKind = 'broker'; if (Math.abs(e.x - BROKER.x) < 5 && Math.abs(e.y - BROKER.y) < 5) { br.phase = 'deliver'; br.until = now + 1600; } }
      else if (br.phase === 'deliver') { e.tx = BROKER.x; e.ty = BROKER.y; e.roamKind = 'broker_ok'; if (now > br.until) br.phase = 'back'; }
      else { const d = DESKS.execution; e.tx = d.x; e.ty = d.y; e.roamKind = 'broker'; if (Math.abs(e.x - d.x) < 5 && Math.abs(e.y - d.y) < 5) br.active = false; }
      moveToward(e, dt); continue;
    }
    const atDesk = e.status === 'working' || e.status === 'blocked';
    if (atDesk) { const d = DESKS[id]; e.tx = d.x; e.ty = d.y; e.roaming = false; e.roamKind = null; }
    else if (standup.active) { e.tx = e.standupSlot.x; e.ty = e.standupSlot.y; e.roamKind = 'meeting'; e.roaming = false; }
    else {
      if (!e.roaming) { e.roaming = true; pickRoam(e); e.dwellUntil = 0; }
      const arrived = Math.abs(e.x - e.tx) < 3 && Math.abs(e.y - e.ty) < 3;
      if (arrived) {
        if (!e.dwellUntil) e.dwellUntil = now + 1500 + Math.random() * 4000;
        else if (now > e.dwellUntil) { pickRoam(e); e.dwellUntil = 0; }
      }
    }
    moveToward(e, dt);
    // idle micro-gestures (stretch, or sip at the coffee machine)
    if (!e.moving && e.status !== 'working' && e.status !== 'blocked') {
      if ((!e.gesture || now > e.gestureUntil) && Math.random() < 0.004) {
        e.gesture = (e.roamKind === 'coffee') ? 'sip' : 'stretch'; e.gestureUntil = now + 1300;
      }
    }
    if (e.gesture && (e.moving || now > e.gestureUntil)) e.gesture = null;
  }
}

function moveToward(e, dt) {
  const dx = e.tx - e.x, dy = e.ty - e.y, dist = Math.hypot(dx, dy), speed = 0.08 * dt;
  if (dist > 1.5) {
    e.x += (dx / dist) * Math.min(speed, dist); e.y += (dy / dist) * Math.min(speed, dist);
    if (Math.abs(dx) > 0.5) e.facing = dx >= 0 ? 1 : -1;
    e.phase += dt * 0.018; e.moving = true;
  } else e.moving = false;
}

const sitting = (e) => (e.status === 'working' || e.status === 'blocked') && !e.moving
  && Math.abs(e.x - DESKS[e.id].x) < 6 && Math.abs(e.y - DESKS[e.id].y) < 6;

/* ============================ drawing ============================ */
function draw(now) {
  const cw = canvas.width, ch = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const scale = Math.min(cw / W, ch / H);
  viewScale = scale; viewOx = (cw - W * scale) / 2; viewOy = (ch - H * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, viewOx, viewOy);
  ctx.textBaseline = 'alphabetic';

  drawFloor();
  drawBackWall(now);
  drawSignalFlow(now);

  const items = [];
  items.push({ y: 455, fn: () => drawServerRack(70, 400, now) });
  items.push({ y: 360, fn: () => drawCoffee(1105, 300) });
  items.push({ y: 530, fn: () => drawWaterCooler(1105, 470) });
  items.push({ y: 560, fn: () => drawWhiteboard(now) });
  items.push({ y: 690, fn: () => drawMeetingTable(985, 640) });
  items.push({ y: BROKER.y + 22, fn: () => drawBroker(BROKER.x, BROKER.y, now) });
  items.push({ y: 735, fn: () => drawPlant(55, 710) });
  items.push({ y: 735, fn: () => drawPlant(1150, 710) });
  items.push({ y: 470, fn: () => drawPlant(905, 430) });
  for (const id in DESKS) {
    const e = ents[id], d = DESKS[id], isSit = sitting(e);
    items.push({ y: d.y + 34, fn: () => { drawWorkstation(id, now); if (isSit) drawSeated(e, now); } });
    if (!isSit) items.push({ y: e.y + 16, fn: () => drawWalking(e, now) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.fn();

  drawSignalTokens(now);
  if (standup.active) drawStandupBanner(now);
  if (selectedId && ents[selectedId]) { drawSelectionRing(ents[selectedId], now); drawInspector(selectedId); }
  else { ctx.fillStyle = 'rgba(127,152,196,0.5)'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('клик по агенту — детали', W / 2, H - 6); }
}

// click a character to inspect it (ties the floor to the live data)
function onClick(ev) {
  const rect = canvas.getBoundingClientRect();
  const lx = ((ev.clientX - rect.left) * (canvas.width / rect.width) - viewOx) / viewScale;
  const ly = ((ev.clientY - rect.top) * (canvas.height / rect.height) - viewOy) / viewScale;
  let best = null, bd = 1e9;
  for (const id in ents) { const e = ents[id]; const d = Math.hypot(e.x - lx, e.y - ly); if (d < bd) { bd = d; best = id; } }
  selectedId = (best && bd < 34 && best === selectedId) ? null : (best && bd < 34 ? best : null);
  if (onSelectCb) onSelectCb(selectedId);
}

function drawSelectionRing(e, now) {
  const p = 0.6 + 0.4 * Math.sin(now / 260);
  ctx.strokeStyle = `rgba(54,208,255,${0.9 * p})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(e.x, e.y + 6, 20, 10, 0, 0, 7); ctx.stroke();
  ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.ellipse(e.x, e.y + 6, 25, 13, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
}

function drawInspector(id) {
  const def = agentsDef.find(a => a.id === id); const e = ents[id];
  const s = e.data || { status: e.status, metrics: {} };
  const st = { working: ['РАБОТАЕТ', '#36e39a'], waiting: ['ОЖИДАНИЕ', '#ffcf5a'], wait: ['ЖДЁТ', '#ffcf5a'], blocked: ['БЛОК', '#ff6b7a'], idle: ['ОФФЛАЙН', '#7f98c4'] }[s.status] || ['—', '#7f98c4'];
  const rows = (def ? def.fields : []).map(([label, key]) => [label, (s.metrics && s.metrics[key] != null && s.metrics[key] !== '') ? String(s.metrics[key]) : '—']);
  const cw = 200, ch = 34 + rows.length * 16 + 10;
  let cx = e.x + 26, cy = e.y - 30;
  if (cx + cw > W - 8) cx = e.x - 26 - cw; if (cx < 8) cx = 8;
  if (cy + ch > H - 8) cy = H - 8 - ch; if (cy < 158) cy = 158;
  // card
  roundRect(cx, cy, cw, ch, 8); ctx.fillStyle = 'rgba(8,16,38,0.96)'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
  // connector
  ctx.strokeStyle = 'rgba(54,208,255,0.4)'; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(cx + (e.x < cx ? 0 : cw), cy + 16); ctx.stroke();
  // header
  ctx.fillStyle = '#eaf4ff'; ctx.font = 'bold 12px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(def ? def.name : id, cx + 10, cy + 17);
  ctx.fillStyle = st[1]; ctx.font = 'bold 9px Segoe UI'; ctx.textAlign = 'right'; ctx.fillText(st[0], cx + cw - 10, cy + 16);
  ctx.fillStyle = 'rgba(127,152,196,0.9)'; ctx.font = '9px Segoe UI'; ctx.textAlign = 'left'; ctx.fillText(def ? def.sub : '', cx + 10, cy + 29);
  ctx.strokeStyle = 'rgba(54,208,255,0.15)'; line(cx + 8, cy + 34, cx + cw - 8, cy + 34);
  // rows
  rows.forEach(([k, v], i) => {
    const ry = cy + 48 + i * 16;
    ctx.fillStyle = 'rgba(127,152,196,0.95)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'left'; ctx.fillText(k, cx + 10, ry);
    ctx.fillStyle = '#eaf4ff'; ctx.textAlign = 'right'; ctx.fillText(v, cx + cw - 10, ry);
  });
}

// a labelled trade signal (e.g. "XAUUSD BUY") traveling Рынок→Стратег→Вход→Исполнение
function drawSignalTokens(now) {
  if (!signals.length) return;
  const anchors = PIPE.map(flowAnchor);
  const segs = []; let total = 0;
  for (let i = 0; i < anchors.length - 1; i++) { const d = Math.hypot(anchors[i + 1].x - anchors[i].x, anchors[i + 1].y - anchors[i].y); segs.push(d); total += d; }
  for (const s of signals) {
    const p = Math.min(1, (now - s.t0) / s.dur); let d = p * total, i = 0;
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
    const k = segs[i] ? d / segs[i] : 0;
    const x = anchors[i].x + (anchors[i + 1].x - anchors[i].x) * k;
    const y = anchors[i].y + (anchors[i + 1].y - anchors[i].y) * k - 14;
    const buy = s.side === 'BUY', col = buy ? '#36e39a' : '#ff6b7a';
    const label = `${s.symbol} ${s.side}`; ctx.font = 'bold 10px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 16;
    roundRect(x - w / 2, y - 10, w, 18, 9); ctx.fillStyle = 'rgba(8,18,40,0.95)'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = buy ? '#36e39a' : '#ff6b7a'; ctx.beginPath();
    if (buy) { ctx.moveTo(x - w / 2 + 7, y + 2); ctx.lineTo(x - w / 2 + 11, y - 4); ctx.lineTo(x - w / 2 + 15, y + 2); } // ▲
    else { ctx.moveTo(x - w / 2 + 7, y - 4); ctx.lineTo(x - w / 2 + 11, y + 2); ctx.lineTo(x - w / 2 + 15, y - 4); } // ▼
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eaf4ff'; ctx.fillText(label, x + 6, y + 3);
  }
}

function drawFloor() {
  ctx.fillStyle = '#0a1328'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(54,208,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 56) line(x, 170, x, H);
  for (let y = 170; y <= H; y += 56) line(0, y, W, y);
  // soft light pools from ceiling
  for (const lx of [300, 600, 900]) {
    const g = ctx.createRadialGradient(lx, 180, 10, lx, 180, 170);
    g.addColorStop(0, 'rgba(120,180,255,0.06)'); g.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = g; ctx.fillRect(lx - 170, 170, 340, 240);
  }
  // central rug under master
  const g = ctx.createRadialGradient(600, 460, 20, 600, 460, 280);
  g.addColorStop(0, 'rgba(54,208,255,0.10)'); g.addColorStop(1, 'rgba(54,208,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(600, 470, 260, 150, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.12)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(600, 470, 250, 142, 0, 0, 7); ctx.stroke();
}

function drawBackWall(now) {
  ctx.fillStyle = '#0b1736'; ctx.fillRect(0, 0, W, 150);
  drawWindow(40, 26, 300, 92, now);
  drawWindow(860, 26, 300, 92, now);
  // central video wall: chart | world map | chart
  const vx = 372, vy = 18, vw = 456, vh = 108;
  roundRect(vx - 6, vy - 6, vw + 12, vh + 12, 8); ctx.fillStyle = '#060c1c'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  const a = vw * 0.27, b = vw * 0.44, gap = 8;
  miniChart(vx, vy, a, vh, 0, now);
  drawWorldMap(vx + a + gap, vy, b - gap, vh, now);
  miniChart(vx + a + b + gap, vy, vw - a - b - gap, vh, 1, now);
  drawTicker(now);
}

const TICKER = [['XAUUSD', '2648.5', true], ['EURUSD', '1.0892', false], ['BTCUSD', '68420', true], ['US500', '5820', true], ['GBPUSD', '1.268', false], ['USDJPY', '149.8', true], ['ETHUSD', '3285', true]];
function drawTicker(now) {
  const y = 150, h = 18, gap = 28;
  ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
  ctx.fillStyle = '#05112a'; ctx.fillRect(0, y, W, h);
  ctx.strokeStyle = 'rgba(54,208,255,0.25)'; ctx.lineWidth = 1; line(0, y, W, y); line(0, y + h, W, y + h);
  ctx.font = '11px Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const cy = y + h / 2;
  const tokW = TICKER.map(([s, p]) => ctx.measureText(`${s} ${p} ▲`).width + gap);
  const total = tokW.reduce((a, b) => a + b, 0);
  let x = -((now / 45) % total);
  while (x < W) {
    for (let i = 0; i < TICKER.length; i++) {
      const [sym, px, up] = TICKER[i]; const label = `${sym} ${px}`, active = activeSymbols.has(sym);
      const wlab = ctx.measureText(label + ' ▲').width;
      if (active) { ctx.fillStyle = 'rgba(255,207,90,0.18)'; roundRect(x - 4, y + 2, wlab + 8, h - 4, 3); ctx.fill(); }
      ctx.fillStyle = active ? '#ffcf5a' : 'rgba(120,210,255,0.9)'; ctx.fillText(label, x, cy);
      ctx.fillStyle = up ? '#36e39a' : '#ff6b7a'; ctx.fillText(up ? '▲' : '▼', x + ctx.measureText(label + ' ').width, cy);
      x += tokW[i];
    }
  }
  ctx.textBaseline = 'alphabetic'; ctx.restore();
}

// accelerated day/night so the sky visibly shifts dawn→day→dusk→night over ~2 min
function smooth(t) { return t * t * (3 - 2 * t); }
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}
function skyFor(now) {
  const phase = ((now / 120000) + 0.72) % 1;                 // 0 = midnight; starts in the evening
  const dayness = Math.max(0, Math.min(1, 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)));
  const twi = Math.max(0, 1 - Math.min(Math.abs(phase - 0.25), Math.abs(phase - 0.75)) / 0.09);
  const top = mixHex('#0a1430', '#2f74d6', smooth(dayness));
  let bot = mixHex('#0a1230', '#bcd9f2', smooth(dayness));
  bot = mixHex(bot, '#c9743a', twi * 0.6);                   // warm horizon at dawn/dusk
  const bld = mixHex('#0c1d44', '#2a3f66', dayness * 0.6);
  let sun, bxf;
  if (phase >= 0.25 && phase < 0.75) { sun = true; bxf = (phase - 0.25) / 0.5; }
  else { sun = false; const np = phase < 0.25 ? phase + 1 : phase; bxf = (np - 0.75) / 0.5; }
  return { top, bot, bld, stars: 1 - dayness, lights: 1 - dayness, sun, bx: bxf, alt: Math.sin(bxf * Math.PI) };
}
function drawWindow(x, y, w, h, now) {
  const sky = skyFor(now);
  roundRect(x, y, w, h, 6); ctx.fillStyle = '#05102a'; ctx.fill();
  ctx.save(); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, sky.top); g.addColorStop(1, sky.bot); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // sun / moon along an arc
  const bx = x + 20 + sky.bx * (w - 40), by = y + h - 18 - sky.alt * (h - 34);
  if (sky.alt > 0.02) {
    if (sky.sun) { const gg = ctx.createRadialGradient(bx, by, 2, bx, by, 16); gg.addColorStop(0, 'rgba(255,236,170,0.9)'); gg.addColorStop(1, 'rgba(255,236,170,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(bx, by, 16, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = 'rgba(230,240,255,0.9)'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill(); ctx.fillStyle = sky.bot; ctx.beginPath(); ctx.arc(bx + 3, by - 3, 6, 0, 7); ctx.fill(); }
  }
  // stars (night only)
  if (sky.stars > 0.02) { ctx.fillStyle = `rgba(255,255,255,${0.6 * sky.stars})`; for (let s = 0; s < 16; s++) ctx.fillRect(x + ((s * 53) % (w - 10)) + 5, y + ((s * 29) % 30) + 4, 1, 1); }
  // skyline + lit windows (brighter at night)
  let sx = x + 6, seed = Math.floor(x);
  while (sx < x + w - 6) {
    const bw = 16 + (seed % 20), bh = 24 + ((seed * 7) % 56); seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const byy = y + h - bh; ctx.fillStyle = sky.bld; ctx.fillRect(sx, byy, bw, bh);
    if (sky.lights > 0.02) { ctx.fillStyle = `rgba(255,220,120,${0.55 * sky.lights})`;
      for (let wy = byy + 4; wy < y + h - 3; wy += 7) for (let wx = sx + 3; wx < sx + bw - 3; wx += 6) if (((wx * 13 + wy * 7 + Math.floor(now / 1700)) % 5) === 0) ctx.fillRect(wx, wy, 2, 3); }
    sx += bw + 5;
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 2; roundRect(x, y, w, h, 6); ctx.stroke();
  line(x + w / 2, y, x + w / 2, y + h);
}

function miniChart(x, y, w, h, idx, now) {
  roundRect(x, y, w, h, 4); ctx.fillStyle = '#081330'; ctx.fill();
  const up = (idx + Math.floor(now / 4000)) % 2 === 0, col = up ? '#36e39a' : '#ff6b7a';
  ctx.strokeStyle = 'rgba(54,208,255,0.1)'; ctx.lineWidth = 1;
  for (let gy = y + 12; gy < y + h; gy += 14) line(x, gy, x + w, gy);
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const px = x + (i / 24) * w;
    const base = up ? (y + h - 8 - (i / 24) * (h - 22)) : (y + 10 + (i / 24) * (h - 22));
    i ? ctx.lineTo(px, base + Math.sin(i * 0.8 + now / 500 + idx) * 6) : ctx.moveTo(px, base);
  }
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.shadowColor = col; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(54,208,255,0.2)'; roundRect(x, y, w, h, 4); ctx.stroke();
}

function drawWorldMap(x, y, w, h, now) {
  roundRect(x, y, w, h, 4); ctx.save(); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#07183a'); g.addColorStop(1, '#061230'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2, rx = w * 0.42, ry = h * 0.42;
  ctx.strokeStyle = 'rgba(54,208,255,0.14)'; ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) { const yy = cy + i * ry / 2.6, rr = Math.sqrt(Math.max(0, 1 - (i / 2.8) ** 2)); ctx.beginPath(); ctx.ellipse(cx, yy, rx * rr, ry * 0.1, 0, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, rx * Math.abs(Math.cos((i / 4) * Math.PI)), ry, 0, 0, 7); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(54,208,255,0.28)'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke();
  const pts = MAP_NODES.map(n => ({ x: x + n[0] * w, y: y + n[1] * h }));
  for (let a = 0; a < MAP_ARCS.length; a++) {
    const p = pts[MAP_ARCS[a][0]], q = pts[MAP_ARCS[a][1]], mx = (p.x + q.x) / 2, my = Math.min(p.y, q.y) - 14;
    ctx.strokeStyle = 'rgba(54,227,154,0.45)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(mx, my, q.x, q.y); ctx.stroke();
    const k = (now / 1600 + a * 0.13) % 1, u = 1 - k;
    ctx.fillStyle = '#36e39a'; ctx.beginPath();
    ctx.arc(u * u * p.x + 2 * u * k * mx + k * k * q.x, u * u * p.y + 2 * u * k * my + k * k * q.y, 1.8, 0, 7); ctx.fill();
  }
  for (const p of pts) { ctx.fillStyle = 'rgba(54,208,255,0.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.5; roundRect(x, y, w, h, 4); ctx.stroke();
  ctx.fillStyle = 'rgba(54,208,255,0.6)'; ctx.font = 'bold 9px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('ГЛОБАЛЬНЫЕ РЫНКИ · 24/7', cx, y + h - 5);
}

/* ---- workstation ---- */
function drawWorkstation(id, now) {
  const d = DESKS[id], e = ents[id], col = accentFor(id);
  const working = e.status === 'working', blocked = e.status === 'blocked';
  const w = d.big ? 150 : 108, h = d.big ? 30 : 24, x = d.x - w / 2, y = d.y + 6;
  drawChair(d.x, d.y - 24);
  // desk top + front edge
  ctx.fillStyle = '#16284a'; roundRect(x, y, w, h, 6); ctx.fill();
  ctx.fillStyle = '#0e1b36'; ctx.fillRect(x, y + h - 2, w, 8);
  ctx.strokeStyle = 'rgba(54,208,255,0.28)'; ctx.lineWidth = 1.2; roundRect(x, y, w, h, 6); ctx.stroke();
  // desk clutter
  drawLamp(x + 12, y + h - 3);
  drawPapers(x + w - 16, y + 9);
  drawMug(x + w - 30, y + 11, col);
  // keyboard + mouse
  ctx.fillStyle = '#20304f'; roundRect(d.x - 20, y + h - 14, 40, 9, 2); ctx.fill(); roundRect(d.x + 26, y + h - 13, 8, 7, 2); ctx.fill();
  // monitors
  const mw = d.big ? 92 : 58, mh = d.big ? 34 : 24, mx = d.x - mw / 2, my = y + h - 2;
  drawMonitor(mx, my, mw, mh, working, blocked, col, now, id);
  if (d.big) { drawMonitor(mx + mw + 6, my + 6, 34, 22, working, blocked, col, now, id + '2'); drawMonitor(mx - 40, my + 6, 34, 22, working, blocked, col, now, id + '3'); }
}

function drawMonitor(x, y, w, h, on, blocked, col, now, seed) {
  ctx.fillStyle = '#0b162c'; ctx.fillRect(x + w / 2 - 3, y + h, 6, 6); ctx.fillRect(x + w / 2 - 9, y + h + 6, 18, 3);
  roundRect(x, y, w, h, 3); ctx.fillStyle = '#0a1428'; ctx.fill();
  ctx.strokeStyle = blocked ? 'rgba(255,93,108,0.9)' : on ? col : 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  const sx = x + 2, sy = y + 2, sw = w - 4, sh = h - 4;
  if (blocked) { ctx.fillStyle = 'rgba(255,93,108,0.25)'; roundRect(sx, sy, sw, sh, 2); ctx.fill(); ctx.fillStyle = '#ff6b7a'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('!', x + w / 2, y + h / 2 + 4); return; }
  ctx.fillStyle = on ? 'rgba(10,22,44,0.95)' : '#0c1730'; roundRect(sx, sy, sw, sh, 2); ctx.fill();
  if (on) {
    const hh = hash(String(seed)); ctx.save(); roundRect(sx, sy, sw, sh, 2); ctx.clip();
    // candlesticks for the main screen, line for small ones
    if (w > 70) { for (let i = 0; i < 8; i++) { const cxx = sx + 5 + i * ((sw - 8) / 8); const up = ((hh + i) % 2) === 0; const hgt = 5 + ((hh * (i + 1)) % Math.floor(sh / 2)); const cyy = sy + sh / 2 - hgt / 2 + Math.sin(i + now / 600) * 3; ctx.fillStyle = up ? '#36e39a' : '#ff6b7a'; ctx.fillRect(cxx, cyy, 3, hgt); ctx.fillRect(cxx + 1, cyy - 3, 1, hgt + 6); } }
    else { ctx.strokeStyle = (hh % 2 ? '#36e39a' : col); ctx.lineWidth = 1.3; ctx.shadowColor = col; ctx.shadowBlur = 5; ctx.beginPath(); for (let i = 0; i <= 14; i++) { const px = sx + (i / 14) * sw; i ? ctx.lineTo(px, sy + sh / 2 + Math.sin(i * 0.9 + now / 350 + hh) * (sh / 3)) : ctx.moveTo(px, sy + sh / 2); } ctx.stroke(); ctx.shadowBlur = 0; }
    ctx.restore();
    // screen sheen
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw * 0.4, sy); ctx.lineTo(sx, sy + sh * 0.6); ctx.closePath(); ctx.fill();
  }
}

function drawChair(x, y) {
  ctx.fillStyle = '#16233f'; roundRect(x - 14, y - 4, 28, 24, 8); ctx.fill();   // backrest
  ctx.fillStyle = '#0f1c36'; roundRect(x - 15, y + 4, 3, 14, 2); ctx.fill(); roundRect(x + 12, y + 4, 3, 14, 2); ctx.fill(); // armrests
  ctx.fillStyle = '#1d2d4d'; roundRect(x - 12, y + 16, 24, 10, 4); ctx.fill();  // seat
}

/* ---- people ---- */
function drawSeated(e, now) {
  const d = DESKS[e.id]; const breath = Math.sin(now / 700 + e.phase) * 0.5;
  const x = d.x, y = d.y - 18 + breath;
  shadow(x, y + 22, 13);
  ctx.fillStyle = e.color; roundRect(x - 11, y - 2, 22, 22, 7); ctx.fill();
  ctx.fillStyle = shade(e.color, -28); roundRect(x + 4, y - 2, 7, 22, 4); ctx.fill();      // body shade
  if (e.look.tie) { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y + 4); ctx.lineTo(x, y + 14); ctx.lineTo(x + 2.5, y + 4); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; roundRect(x - 11, y - 2, 22, 22, 7); ctx.stroke();
  const hot = hotPipeline();                                             // type harder on a hot signal
  const t = e.status === 'working' ? Math.sin(now * (hot ? 0.035 : 0.02)) * (hot ? 2.6 : 1.6) : 0;
  ctx.fillStyle = e.color; roundRect(x - 15, y + 8 + t, 7, 12, 3); ctx.fill(); roundRect(x + 8, y + 8 - t, 7, 12, 3); ctx.fill();
  ctx.fillStyle = e.skin; ctx.beginPath(); ctx.arc(x - 12, y + 20 + t, 3, 0, 7); ctx.arc(x + 12, y + 20 - t, 3, 0, 7); ctx.fill();
  drawHead(e, x, y - 12, now);
  emote(e, x, y - 30, now);
  nameplate(e, x, y + 30);
}

function drawWalking(e, now) {
  const x = e.x, y = e.y, walk = e.moving ? Math.sin(e.phase) : Math.sin(now / 700 + e.phase) * 0.3;
  shadow(x, y + 15, 11);
  ctx.fillStyle = '#1b2b4d'; roundRect(x - 6, y + 6 + walk * 2, 5, 11, 2); ctx.fill(); roundRect(x + 1, y + 6 - walk * 2, 5, 11, 2); ctx.fill();
  ctx.fillStyle = e.color; roundRect(x - 9, y - 10, 18, 20, 6); ctx.fill();
  ctx.fillStyle = shade(e.color, -28); roundRect(x + 3, y - 10, 6, 20, 4); ctx.fill();
  if (e.look.tie) { ctx.fillStyle = '#c0392b'; ctx.fillRect(x - 1.5, y - 8, 3, 12); }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; roundRect(x - 9, y - 10, 18, 20, 6); ctx.stroke();
  if (e.gesture === 'stretch' && !e.moving) {                 // arms raised
    ctx.fillStyle = e.color; roundRect(x - 12, y - 17, 5, 14, 3); ctx.fill(); roundRect(x + 7, y - 17, 5, 14, 3); ctx.fill();
    ctx.fillStyle = e.skin; ctx.beginPath(); ctx.arc(x - 9.5, y - 17, 2.6, 0, 7); ctx.arc(x + 9.5, y - 17, 2.6, 0, 7); ctx.fill();
  } else if (e.gesture === 'sip' && !e.moving) {               // raise a mug to the face
    ctx.fillStyle = e.color; roundRect(x - 12, y - 7, 5, 13, 3); ctx.fill(); roundRect(x + 5, y - 11, 5, 12, 3); ctx.fill();
    ctx.fillStyle = e.skin; ctx.beginPath(); ctx.arc(x - 9.5, y + 5, 2.6, 0, 7); ctx.arc(x + 8, y - 12, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8eef7'; roundRect(x + 6, y - 16, 5, 5, 1); ctx.fill();
  } else {
    ctx.fillStyle = e.color; roundRect(x - 12, y - 7 + walk * 2.5, 5, 13, 3); ctx.fill(); roundRect(x + 7, y - 7 - walk * 2.5, 5, 13, 3); ctx.fill();
    ctx.fillStyle = e.skin; ctx.beginPath(); ctx.arc(x - 9.5, y + 5 + walk * 2.5, 2.6, 0, 7); ctx.arc(x + 9.5, y + 5 - walk * 2.5, 2.6, 0, 7); ctx.fill();
  }
  drawHead(e, x + e.facing, y - 16, now);
  emote(e, x, y - 32, now);
  nameplate(e, x, y + 26);
}

function drawHead(e, x, y, now) {
  const st = e.status, worried = st === 'blocked', focused = st === 'working';
  const blink = (((now || 0) + e.blinkOffset) % 3800) < 140;
  ctx.fillStyle = shade(e.skin, -25); ctx.fillRect(x - 3, y + 6, 6, 4);        // neck
  ctx.fillStyle = e.skin; ctx.beginPath(); ctx.arc(x - 7, y, 1.8, 0, 7); ctx.arc(x + 7, y, 1.8, 0, 7); ctx.fill(); // ears
  ctx.beginPath(); ctx.arc(x, y, 7.2, 0, 7); ctx.fill();                        // face
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
  if (e.beard) { ctx.fillStyle = e.hair; ctx.beginPath(); ctx.arc(x, y + 2, 6.6, 0.12 * Math.PI, 0.88 * Math.PI); ctx.fill(); }
  drawHair(e, x, y);
  // brows
  ctx.strokeStyle = '#2a2320'; ctx.lineWidth = 1; ctx.beginPath();
  if (worried) { ctx.moveTo(x - 4.2, y - 1.4); ctx.lineTo(x - 1.4, y - 0.4); ctx.moveTo(x + 4.2, y - 1.4); ctx.lineTo(x + 1.4, y - 0.4); }
  else if (focused) { ctx.moveTo(x - 4.2, y - 1.1); ctx.lineTo(x - 1.4, y - 1.4); ctx.moveTo(x + 4.2, y - 1.1); ctx.lineTo(x + 1.4, y - 1.4); }
  else { ctx.moveTo(x - 4.2, y - 1.9); ctx.lineTo(x - 1.6, y - 2.1); ctx.moveTo(x + 4.2, y - 1.9); ctx.lineTo(x + 1.6, y - 2.1); }
  ctx.stroke();
  if (blink) { ctx.strokeStyle = '#14202f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 3.4, y + 1); ctx.lineTo(x - 1.4, y + 1); ctx.moveTo(x + 1.4, y + 1); ctx.lineTo(x + 3.4, y + 1); ctx.stroke(); } // blink
  else { ctx.fillStyle = '#14202f'; ctx.beginPath(); ctx.arc(x - 2.4, y + 1, 1, 0, 7); ctx.arc(x + 2.4, y + 1, 1, 0, 7); ctx.fill(); } // eyes
  if (e.look.glasses) { ctx.strokeStyle = 'rgba(20,30,47,0.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x - 2.4, y + 1, 2.3, 0, 7); ctx.arc(x + 2.4, y + 1, 2.3, 0, 7); ctx.moveTo(x - 0.1, y + 1); ctx.lineTo(x + 0.1, y + 1); ctx.stroke(); }
  // mouth
  ctx.strokeStyle = '#7a4b3a'; ctx.lineWidth = 1; ctx.beginPath();
  if (worried) ctx.arc(x, y + 6, 2, 1.1 * Math.PI, 1.9 * Math.PI);
  else if (focused) { ctx.moveTo(x - 1.6, y + 4.6); ctx.lineTo(x + 1.6, y + 4.6); }
  else ctx.arc(x, y + 3.6, 2, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();
  if (worried) { ctx.fillStyle = 'rgba(120,200,255,0.9)'; ctx.beginPath(); ctx.ellipse(x + 6.5, y - 1, 1.4, 2.3, 0, 0, 7); ctx.fill(); } // sweat
  if (e.look.headset) {
    ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 1, 8.2, 1.05 * Math.PI, 1.95 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#2a3a5a'; ctx.fillRect(x - 9.5, y - 1, 3, 5);
    ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 8, y + 3); ctx.quadraticCurveTo(x - 11, y + 7, x - 4, y + 7.5); ctx.stroke();
  }
}

function drawHair(e, x, y) {
  if (e.hairStyle === 4) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(x - 2, y - 3, 2, 0, 7); ctx.fill(); return; } // bald
  ctx.fillStyle = e.hair;
  if (e.hairStyle === 0) { ctx.beginPath(); ctx.arc(x, y - 1, 7.6, Math.PI, 2 * Math.PI); ctx.fill(); ctx.fillRect(x - 7.4, y - 1, 2.2, 5); ctx.fillRect(x + 5.2, y - 1, 2.2, 5); }
  else if (e.hairStyle === 1) { ctx.fillRect(x - 7.6, y - 8, 15.2, 6); ctx.beginPath(); ctx.arc(x, y - 2, 7.6, Math.PI, 2 * Math.PI); ctx.fill(); }
  else if (e.hairStyle === 2) { ctx.beginPath(); ctx.arc(x, y - 2, 7.6, Math.PI, 2 * Math.PI); ctx.fill(); ctx.fillRect(x - 7.6, y - 2, 5, 3); }
  else { ctx.beginPath(); ctx.arc(x, y - 2, 7.4, Math.PI, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.arc(x + 7.5, y + 1, 3, 0, 7); ctx.fill(); } // ponytail
}

function nameplate(e, x, y) {
  const label = SHORT[e.id] || e.id; ctx.font = '9px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 10, st = e.status;
  const bg = st === 'working' ? 'rgba(54,227,154,0.18)' : st === 'blocked' ? 'rgba(255,93,108,0.22)' : 'rgba(12,24,52,0.8)';
  roundRect(x - w / 2, y - 9, w, 13, 4); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.25)'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.fillStyle = 'rgba(234,244,255,0.95)'; ctx.fillText(label, x, y + 1);
}

function emote(e, x, y, now) {
  const bob = Math.sin(now / 400 + e.phase) * 1.5;
  let emoji = '💭', bg = 'rgba(12,24,52,0.92)', brd = 'rgba(54,208,255,0.3)';
  if (e.status === 'working') emoji = '💻';
  else if (e.status === 'blocked') { emoji = '🚫'; bg = 'rgba(255,93,108,0.3)'; brd = 'rgba(255,93,108,0.6)'; }
  else if (e.roamKind === 'coffee') emoji = '☕';
  else if (e.roamKind === 'water') emoji = '💧';
  else if (e.roamKind === 'meeting') emoji = '💬';
  else if (e.roamKind === 'core') emoji = '🔧';
  else if (e.roamKind === 'broker') emoji = '📦';
  else if (e.roamKind === 'broker_ok') emoji = '✅';
  else if (e.roamKind === 'desk') emoji = '🔎';
  roundRect(x - 12, y - 12 + bob, 24, 21, 7); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = brd; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 4, y + 8 + bob); ctx.lineTo(x, y + 13 + bob); ctx.lineTo(x + 4, y + 8 + bob); ctx.fillStyle = bg; ctx.fill();
  ctx.font = '13px serif'; ctx.textAlign = 'center'; ctx.fillText(emoji, x, y + 4 + bob);
}

/* ---- props ---- */
function drawLamp(x, y) {
  ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 11); ctx.lineTo(x + 8, y - 17); ctx.stroke();
  ctx.fillStyle = '#2a3a5a'; ctx.beginPath(); ctx.moveTo(x + 8, y - 17); ctx.lineTo(x + 13, y - 12); ctx.lineTo(x + 5, y - 11); ctx.closePath(); ctx.fill();
  const g = ctx.createRadialGradient(x + 9, y - 8, 1, x + 9, y - 8, 22); g.addColorStop(0, 'rgba(255,220,150,0.33)'); g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + 9, y - 5, 22, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(x + 9, y - 12, 1.5, 0, 7); ctx.fill();
}
function drawPapers(x, y) {
  for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(x, y); ctx.rotate((i - 1) * 0.12); ctx.fillStyle = '#dfe6f2'; roundRect(-7, -5, 14, 10, 1); ctx.fill(); ctx.restore(); }
  ctx.strokeStyle = 'rgba(120,140,170,0.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); for (let l = 0; l < 3; l++) { ctx.moveTo(x - 4, y - 2 + l * 3); ctx.lineTo(x + 5, y - 2 + l * 3); } ctx.stroke();
}
function drawMug(x, y, col) {
  ctx.fillStyle = '#e8eef7'; roundRect(x - 3, y - 4, 6, 8, 1); ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(x - 3, y - 4, 6, 2);
  ctx.strokeStyle = '#cbd6e6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 4, y, 2, -0.5 * Math.PI, 0.5 * Math.PI); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(x - 1, y - 6); ctx.quadraticCurveTo(x + 1, y - 8, x - 1, y - 11); ctx.stroke();
}

function drawServerRack(x, y, now) {
  roundRect(x, y, 56, 108, 6); ctx.fillStyle = '#0d1b38'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const uy = y + 8 + i * 16; ctx.fillStyle = '#132547'; roundRect(x + 5, uy, 46, 12, 2); ctx.fill();
    for (let k = 0; k < 3; k++) { const on = ((i * 3 + k + Math.floor(now / 500)) % 4) !== 0; ctx.fillStyle = on ? (k === 0 ? '#36e39a' : '#36d0ff') : '#1c3254'; ctx.beginPath(); ctx.arc(x + 12 + k * 7, uy + 6, 1.8, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(54,208,255,0.25)'; ctx.fillRect(x + 36, uy + 4, 11, 4);
  }
  const g = ctx.createRadialGradient(x + 28, y + 54, 4, x + 28, y + 54, 60); g.addColorStop(0, 'rgba(54,208,255,0.12)'); g.addColorStop(1, 'rgba(54,208,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - 30, y - 10, 120, 140);
  ctx.fillStyle = 'rgba(54,208,255,0.8)'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('ЯДРО', x + 28, y + 122);
}

function drawCoffee(x, y) {
  roundRect(x - 16, y - 24, 32, 48, 5); ctx.fillStyle = '#17273f'; ctx.fill(); ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#0a1428'; roundRect(x - 11, y - 18, 22, 10, 2); ctx.fill(); ctx.fillStyle = '#36e39a'; ctx.fillRect(x - 8, y - 15, 5, 4);
  ctx.fillStyle = '#20304f'; roundRect(x - 8, y + 2, 16, 10, 2); ctx.fill(); ctx.fillStyle = '#eee'; roundRect(x - 5, y + 5, 10, 7, 2); ctx.fill();
  ctx.fillStyle = 'rgba(127,152,196,0.75)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Кофе', x, y + 36);
}
function drawWaterCooler(x, y) {
  roundRect(x - 13, y - 6, 26, 34, 4); ctx.fillStyle = '#17273f'; ctx.fill(); ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = 'rgba(54,208,255,0.5)'; roundRect(x - 9, y - 24, 18, 20, 6); ctx.fill(); ctx.fillStyle = 'rgba(54,208,255,0.3)'; ctx.fillRect(x - 3, y - 28, 6, 6);
  ctx.fillStyle = 'rgba(127,152,196,0.75)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Вода', x, y + 40);
}
function drawMeetingTable(x, y) {
  ctx.fillStyle = '#13233f'; ctx.beginPath(); ctx.ellipse(x, y, 60, 30, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 60, 30, 0, 0, 7); ctx.stroke();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.fillStyle = '#1b2b4d'; roundRect(x + Math.cos(a) * 78 - 7, y + Math.sin(a) * 44 - 7, 14, 14, 4); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,207,90,0.6)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Переговорная', x, y + 56);
}
function drawBroker(x, y, now) {
  roundRect(x - 28, y - 22, 56, 40, 6); ctx.fillStyle = '#14233f'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.4)'; ctx.lineWidth = 1.4; ctx.stroke();
  roundRect(x - 22, y - 16, 44, 22, 3); ctx.fillStyle = '#0a1428'; ctx.fill();
  // order book bars
  for (let i = 0; i < 5; i++) { const on = ((i + Math.floor(now / 400)) % 5) !== 0; ctx.fillStyle = on ? '#36e39a' : '#1c3254'; ctx.fillRect(x - 18 + i * 8, y - 2 - (i % 3) * 3, 5, 3 + (i % 3) * 3); }
  // link indicator
  ctx.fillStyle = '#36e39a'; ctx.beginPath(); ctx.arc(x + 18, y - 12, 2, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(54,208,255,0.8)'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Брокер', x, y + 30);
}

function drawWhiteboard(now) {
  const x = WHITEBOARD.x, y = WHITEBOARD.y, w = 92, h = 58;
  ctx.strokeStyle = '#32456a'; ctx.lineWidth = 2; line(x - 24, y + h / 2, x - 30, y + h / 2 + 22); line(x + 24, y + h / 2, x + 30, y + h / 2 + 22);
  roundRect(x - w / 2, y - h / 2, w, h, 4); ctx.fillStyle = '#eef3fb'; ctx.fill(); ctx.strokeStyle = '#b9c6db'; ctx.lineWidth = 2; ctx.stroke();
  // scribbles: an up-trend line + bullets
  ctx.strokeStyle = '#2aa06a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 36, y + 14); ctx.lineTo(x - 20, y + 4); ctx.lineTo(x - 6, y + 8); ctx.lineTo(x + 10, y - 8); ctx.lineTo(x + 30, y - 14); ctx.stroke();
  ctx.fillStyle = '#c0392b'; ctx.font = '9px Segoe UI'; ctx.textAlign = 'left'; ctx.fillText('LONG', x - 36, y - 10);
  ctx.fillStyle = '#4a6a9c'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x - 34, y + 20 + i * 7, 1.5, 0, 7); ctx.fill(); ctx.fillRect(x - 29, y + 19 + i * 7, 20, 2); }
  if (standup.active) { const p = 0.5 + 0.5 * Math.sin(now / 250); ctx.strokeStyle = `rgba(255,207,90,${0.5 * p})`; ctx.lineWidth = 2; roundRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, 5); ctx.stroke(); }
}

function drawPlant(x, y) {
  ctx.fillStyle = '#153b2b'; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.5; ctx.ellipse(x + Math.cos(a) * 10, y - 14 + Math.sin(a) * 8, 7, 13, a, 0, 7); } ctx.fill();
  ctx.fillStyle = '#2aa06a'; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.5; ctx.ellipse(x + Math.cos(a) * 8, y - 16 + Math.sin(a) * 6, 5, 10, a, 0, 7); } ctx.fill();
  ctx.fillStyle = '#7a5433'; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.lineTo(x + 6, y + 14); ctx.lineTo(x - 6, y + 14); ctx.closePath(); ctx.fill();
}

/* ---- signal pipeline ---- */
function flowAnchor(id) { const d = DESKS[id]; return { x: d.x, y: d.y + 28 }; }
function drawSignalFlow(now) {
  ctx.save();
  for (let i = 0; i < PIPE.length - 1; i++) {
    const a = flowAnchor(PIPE[i]), b = flowAnchor(PIPE[i + 1]);
    const hot = ents[PIPE[i]].status === 'working' || ents[PIPE[i + 1]].status === 'working';
    ctx.setLineDash([5, 9]); ctx.lineDashOffset = -(now / 35) % 14;
    ctx.strokeStyle = hot ? 'rgba(54,208,255,0.55)' : 'rgba(54,208,255,0.12)'; ctx.lineWidth = hot ? 2 : 1.2; line(a.x, a.y, b.x, b.y);
    ctx.setLineDash([]); arrowHead(a, b, hot ? '#36d0ff' : 'rgba(54,208,255,0.3)', 0.82);
    if (hot) for (const off of [0, 0.5]) { const k = (now / 1500 + off) % 1; ctx.fillStyle = '#36d0ff'; ctx.shadowColor = '#36d0ff'; ctx.shadowBlur = 8; circle(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 3); ctx.shadowBlur = 0; }
  }
  ctx.restore();
}
function arrowHead(a, b, color, t) {
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, 4.5); ctx.lineTo(-4, -4.5); ctx.closePath(); ctx.fill(); ctx.restore();
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

function drawStandupBanner(now) {
  const x = TABLE.x, y = TABLE.y - 120, pulse = 0.6 + 0.4 * Math.sin(now / 300);
  roundRect(x - 68, y - 15, 136, 26, 8); ctx.fillStyle = `rgba(255,207,90,${0.14 * pulse})`; ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#ffcf5a'; ctx.font = 'bold 12px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('СТЕНДАП', x, y + 3);
}

/* ---- helpers ---- */
function shadow(x, y, r) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.38, 0, 0, 7); ctx.fill(); }
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const r = Math.max(0, Math.min(255, (n >> 16) + amt)); const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)); const b = Math.max(0, Math.min(255, (n & 255) + amt)); return `rgb(${r},${g},${b})`; }

window.Office = Office;

})();
