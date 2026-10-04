'use strict';
/* AI Trading Office — "Зал" (pixel office floor) renderer.
 *
 * Second BODY over the SAME world state (agent-office principle: style is just a
 * swappable view). Each agent is a little person who sits and types at their desk
 * when WORKING, wanders the hall / goes for coffee when WAITING, and flashes red
 * when BLOCKED. It reads the latest snapshot via Office.update(world) — it never
 * invents state; movement/animation is pure presentation derived from status. */
(() => {

const SHORT = {
  market: 'Рынок', liquidity: 'Ликв./ROI', strategy: 'Стратег', entry: 'Вход',
  master: 'Мастер', exit: 'Выход', risk: 'Риск', execution: 'Исполн.'
};
const ACCENT = { cyan: '#36d0ff', gold: '#ffcf5a', violet: '#b58bff' };

// logical world (letterboxed into the canvas)
const W = 1200, H = 760;

// desk seat positions (where the character sits + types)
const DESKS = {
  market:    { x: 210, y: 190 }, liquidity: { x: 440, y: 190 },
  strategy:  { x: 760, y: 190 }, entry:     { x: 990, y: 190 },
  master:    { x: 600, y: 400, big: true },
  risk:      { x: 210, y: 600 }, execution: { x: 440, y: 600 }, exit: { x: 760, y: 600 }
};
// roam destinations for waiting agents
const ROAM = [
  { x: 1060, y: 560, kind: 'coffee' }, { x: 1060, y: 230, kind: 'water' },
  { x: 600,  y: 660, kind: 'lounge' }, { x: 360,  y: 400, kind: 'wander' },
  { x: 850,  y: 400, kind: 'wander' }, { x: 600,  y: 300, kind: 'wander' }
];

let canvas, ctx, raf = 0, last = 0, dpr = 1;
let ents = {};          // id -> entity
let agentsDef = null;

function accentFor(id) {
  const a = agentsDef.find(x => x.id === id);
  return ACCENT[a ? a.accent : 'cyan'] || ACCENT.cyan;
}

function initEntities() {
  ents = {};
  for (const a of agentsDef) {
    const d = DESKS[a.id] || { x: 600, y: 400 };
    ents[a.id] = {
      id: a.id, x: d.x, y: d.y, tx: d.x, ty: d.y,
      status: 'waiting', phase: Math.random() * 10, facing: 1,
      roaming: false, dwellUntil: 0, roamKind: null, color: accentFor(a.id)
    };
  }
}

function pickRoam(e) {
  // mostly wander/coffee, sometimes return to own desk to "check" something
  if (Math.random() < 0.3) { const d = DESKS[e.id]; e.tx = d.x; e.ty = d.y; e.roamKind = 'desk'; return; }
  const r = ROAM[Math.floor(Math.random() * ROAM.length)];
  e.tx = r.x; e.ty = r.y; e.roamKind = r.kind;
}

// ---- public API ----
const Office = {
  init(cv, agents) {
    canvas = cv; ctx = cv.getContext('2d'); agentsDef = agents; initEntities();
  },
  update(world) {
    if (!world || !world.agents) return;
    for (const id in ents) {
      const s = world.agents[id];
      if (s) ents[id].status = s.status;
    }
  },
  start() { if (!raf) { last = performance.now(); loop(performance.now()); } },
  stop() { cancelAnimationFrame(raf); raf = 0; }
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
  step(dt, now);
  draw(now);
}

function step(dt, now) {
  for (const id in ents) {
    const e = ents[id];
    const atDesk = e.status === 'working' || e.status === 'blocked';
    if (atDesk) {
      const d = DESKS[id]; e.tx = d.x; e.ty = d.y; e.roaming = false; e.roamKind = null;
    } else {
      // waiting/idle → roam the hall
      if (!e.roaming) { e.roaming = true; pickRoam(e); e.dwellUntil = 0; }
      const arrived = Math.abs(e.x - e.tx) < 3 && Math.abs(e.y - e.ty) < 3;
      if (arrived) {
        if (!e.dwellUntil) e.dwellUntil = now + 1500 + Math.random() * 4000;
        else if (now > e.dwellUntil) { pickRoam(e); e.dwellUntil = 0; }
      }
    }
    // move toward target
    const dx = e.tx - e.x, dy = e.ty - e.y, dist = Math.hypot(dx, dy);
    const speed = 0.085 * dt; // logical px per ms
    if (dist > 1.5) {
      e.x += (dx / dist) * Math.min(speed, dist);
      e.y += (dy / dist) * Math.min(speed, dist);
      e.facing = dx >= 0 ? 1 : -1;
      e.phase += dt * 0.02;
      e.moving = true;
    } else { e.moving = false; }
  }
}

// ---------- drawing ----------
function draw(now) {
  const cw = canvas.width, ch = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const scale = Math.min(cw / W, ch / H);
  const ox = (cw - W * scale) / 2, oy = (ch - H * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);

  drawRoom();
  // desks first (so characters overlap them)
  for (const id in DESKS) drawDesk(id);
  drawZones();
  // characters sorted by y for pseudo-depth
  const order = Object.values(ents).sort((a, b) => a.y - b.y);
  for (const e of order) drawPerson(e, now);
}

function drawRoom() {
  // floor
  ctx.fillStyle = '#0a1430'; ctx.fillRect(0, 0, W, H);
  // carpet glow center
  const g = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, 520);
  g.addColorStop(0, 'rgba(54,208,255,0.10)'); g.addColorStop(1, 'rgba(54,208,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // tile grid
  ctx.strokeStyle = 'rgba(54,208,255,0.06)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // walls
  ctx.strokeStyle = 'rgba(54,208,255,0.28)'; ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W - 20, H - 20);
}

function drawDesk(id) {
  const d = DESKS[id]; const e = ents[id];
  const working = e && e.status === 'working';
  const blocked = e && e.status === 'blocked';
  const col = accentFor(id);
  const w = d.big ? 150 : 96, h = d.big ? 66 : 46;
  const x = d.x - w / 2, y = d.y - h / 2 - 6;
  // table
  roundRect(x, y, w, h, 8); ctx.fillStyle = '#10213f'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
  // monitor
  const mw = d.big ? 86 : 54, mh = d.big ? 30 : 20;
  const mx = d.x - mw / 2, my = y + 6;
  roundRect(mx, my, mw, mh, 3);
  ctx.fillStyle = blocked ? 'rgba(255,93,108,0.9)' : working ? col : '#1a2b4d';
  ctx.globalAlpha = blocked ? 0.85 : working ? 0.9 : 0.5; ctx.fill(); ctx.globalAlpha = 1;
  if (working) { ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
  // (the person's nameplate identifies the desk; no separate desk label to avoid overlap)
}

function drawZones() {
  // coffee
  drawProp(1060, 560, '☕', 'Кофе');
  drawProp(1060, 230, '💧', 'Вода');
  drawProp(600, 665, '🪑', 'Лаундж');
  // plants
  drawProp(60, 90, '🪴', '');
  drawProp(W - 60, H - 90, '🪴', '');
}

function drawProp(x, y, emoji, label) {
  ctx.font = '26px serif'; ctx.textAlign = 'center';
  ctx.fillText(emoji, x, y);
  if (label) { ctx.fillStyle = 'rgba(127,152,196,0.6)'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(label, x, y + 16); }
}

function drawPerson(e, now) {
  const x = e.x, y = e.y;
  const walk = e.moving ? Math.sin(e.phase) : 0;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x, y + 16, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  ctx.fillStyle = '#1b2b4d';
  ctx.fillRect(x - 5, y + 6 + walk * 1.5, 4, 9);
  ctx.fillRect(x + 1, y + 6 - walk * 1.5, 4, 9);
  // body
  roundRect(x - 8, y - 10, 16, 18, 4); ctx.fillStyle = e.color; ctx.fill();
  // typing arms when working at desk
  if (e.status === 'working' && !e.moving) {
    const t = Math.sin(now * 0.02) * 1.5;
    ctx.fillStyle = shade(e.color, -20);
    ctx.fillRect(x - 10, y - 2 + t, 4, 7); ctx.fillRect(x + 6, y - 2 - t, 4, 7);
  }
  // head
  ctx.beginPath(); ctx.fillStyle = '#f0d3b0';
  ctx.arc(x, y - 16, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a2320'; // hair
  ctx.beginPath(); ctx.arc(x, y - 18, 6, Math.PI, Math.PI * 2); ctx.fill();
  // nameplate
  ctx.fillStyle = 'rgba(215,231,255,0.85)'; ctx.font = '9px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(SHORT[e.id] || e.id, x, y + 26);
  // emote bubble
  drawEmote(e, x, y - 30);
}

function drawEmote(e, x, y) {
  let emoji = '💭', bg = 'rgba(12,24,52,0.9)';
  if (e.status === 'working') emoji = '💻';
  else if (e.status === 'blocked') { emoji = '🚫'; bg = 'rgba(255,93,108,0.25)'; }
  else if (e.roamKind === 'coffee') emoji = '☕';
  else if (e.roamKind === 'water') emoji = '💧';
  else if (e.roamKind === 'desk') emoji = '🔎';
  else emoji = '💭';
  roundRect(x - 11, y - 12, 22, 20, 6); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = '13px serif'; ctx.textAlign = 'center'; ctx.fillText(emoji, x, y + 3);
}

// ---- small canvas helpers ----
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

window.Office = Office;

})();
