'use strict';
/* AI Trading Office — "Зал" (pixel office floor) renderer, rich edition.
 *
 * Second BODY over the SAME world state (agent-office principle: style is just a
 * swappable view). Each agent is a little person who sits and types at a proper
 * workstation when WORKING, stands/walks the hall when WAITING (coffee, water,
 * meeting, a glance at the "core" rack), and slumps red when BLOCKED. Movement
 * and animation are pure presentation derived from status — never invented. */
(() => {

const SHORT = {
  market: 'Рынок', liquidity: 'Ликв./ROI', strategy: 'Стратег', entry: 'Вход',
  master: 'Мастер', exit: 'Выход', risk: 'Риск', execution: 'Исполн.'
};
const ACCENT = { cyan: '#36d0ff', gold: '#ffcf5a', violet: '#b58bff' };
const SKINS = ['#f3d2b3', '#e8be99', '#d49a6a', '#b97a4e', '#8d5a3c'];
const HAIRS = ['#2a2320', '#4a2f1a', '#6b4423', '#a8761f', '#8a8f99', '#111317'];

const W = 1200, H = 760;        // logical world (letterboxed into the canvas)

// desk seat positions
const DESKS = {
  market:    { x: 205, y: 275 }, liquidity: { x: 420, y: 275 },
  strategy:  { x: 780, y: 275 }, entry:     { x: 995, y: 275 },
  master:    { x: 600, y: 450, big: true },
  risk:      { x: 205, y: 615 }, execution: { x: 420, y: 615 }, exit: { x: 780, y: 615 }
};
// roam destinations for waiting agents
const ROAM = [
  { x: 1095, y: 330, kind: 'coffee' }, { x: 1095, y: 500, kind: 'water' },
  { x: 985,  y: 650, kind: 'meeting' }, { x: 150, y: 450, kind: 'core' },
  { x: 560,  y: 560, kind: 'wander' }, { x: 640, y: 360, kind: 'wander' }
];

let canvas, ctx, raf = 0, last = 0, dpr = 1;
let ents = {}, agentsDef = null;

// signal pipeline (Рынок → Стратег → Вход → Исполнение) and standup gathering
const PIPE = ['market', 'strategy', 'entry', 'execution'];
const TABLE = { x: 985, y: 640 };
let standup = { active: false, until: 0, nextAt: 0 };

const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
function accentFor(id) { const a = agentsDef.find(x => x.id === id); return ACCENT[a ? a.accent : 'cyan'] || ACCENT.cyan; }

function initEntities() {
  ents = {};
  const N = agentsDef.length;
  agentsDef.forEach((a, i) => {
    const d = DESKS[a.id] || { x: 600, y: 450 }; const hh = hash(a.id);
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;        // slot around the meeting table
    ents[a.id] = {
      id: a.id, x: d.x, y: d.y, tx: d.x, ty: d.y, status: 'waiting',
      phase: Math.random() * 10, facing: 1, moving: false,
      roaming: false, dwellUntil: 0, roamKind: null,
      standupSlot: { x: TABLE.x + Math.cos(ang) * 102, y: TABLE.y + Math.sin(ang) * 60 },
      color: accentFor(a.id), skin: SKINS[hh % SKINS.length],
      hair: HAIRS[(hh >> 3) % HAIRS.length], hairStyle: hh % 3
    };
  });
  standup = { active: false, until: 0, nextAt: performance.now() + 20000 };
}

function pickRoam(e) {
  if (Math.random() < 0.28) { const d = DESKS[e.id]; e.tx = d.x; e.ty = d.y; e.roamKind = 'desk'; return; }
  const r = ROAM[Math.floor(Math.random() * ROAM.length)];
  e.tx = r.x; e.ty = r.y; e.roamKind = r.kind;
}

const Office = {
  init(cv, agents) { canvas = cv; ctx = cv.getContext('2d'); agentsDef = agents; initEntities(); },
  update(world) {
    if (!world || !world.agents) return;
    for (const id in ents) { const s = world.agents[id]; if (s) ents[id].status = s.status; }
  },
  start() { if (!raf) { last = performance.now(); loop(performance.now()); } },
  stop() { cancelAnimationFrame(raf); raf = 0; },
  forceStandup() { standup.active = true; standup.until = performance.now() + 20000; }
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
    for (const id in ents) ents[id].roaming = false;   // disperse: re-pick roam targets
  } else if (!standup.active && now > standup.nextAt) {
    standup.active = true; standup.until = now + 9000;
  }
}

function step(dt, now) {
  manageStandup(now);
  for (const id in ents) {
    const e = ents[id];
    const atDesk = e.status === 'working' || e.status === 'blocked';
    if (atDesk) { const d = DESKS[id]; e.tx = d.x; e.ty = d.y; e.roaming = false; e.roamKind = null; }
    else if (standup.active) {
      // agents who aren't busy gather around the meeting table for a standup
      e.tx = e.standupSlot.x; e.ty = e.standupSlot.y; e.roamKind = 'meeting'; e.roaming = false;
    }
    else {
      if (!e.roaming) { e.roaming = true; pickRoam(e); e.dwellUntil = 0; }
      const arrived = Math.abs(e.x - e.tx) < 3 && Math.abs(e.y - e.ty) < 3;
      if (arrived) {
        if (!e.dwellUntil) e.dwellUntil = now + 1500 + Math.random() * 4000;
        else if (now > e.dwellUntil) { pickRoam(e); e.dwellUntil = 0; }
      }
    }
    const dx = e.tx - e.x, dy = e.ty - e.y, dist = Math.hypot(dx, dy);
    const speed = 0.08 * dt;
    if (dist > 1.5) {
      e.x += (dx / dist) * Math.min(speed, dist); e.y += (dy / dist) * Math.min(speed, dist);
      if (Math.abs(dx) > 0.5) e.facing = dx >= 0 ? 1 : -1;
      e.phase += dt * 0.018; e.moving = true;
    } else e.moving = false;
  }
}

const seated = (e) => (e.status === 'working' || e.status === 'blocked') && !e.moving
  && Math.abs(e.x - DESKS[e.id].x) < 6 && Math.abs(e.y - DESKS[e.id].y) < 6;

/* ============================ drawing ============================ */
function draw(now) {
  const cw = canvas.width, ch = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const scale = Math.min(cw / W, ch / H);
  ctx.setTransform(scale, 0, 0, scale, (cw - W * scale) / 2, (ch - H * scale) / 2);
  ctx.textBaseline = 'alphabetic';

  drawFloor();
  drawBackWall(now);
  drawSignalFlow(now);     // pipeline arrows on the floor, beneath furniture & people

  // Depth-sorted scene: static props + desks + people, painted back-to-front by y.
  const items = [];
  items.push({ y: 455, fn: () => drawServerRack(70, 400, now) });      // "ядро" on left wall
  items.push({ y: 360, fn: () => drawCoffee(1105, 300) });
  items.push({ y: 530, fn: () => drawWaterCooler(1105, 470) });
  items.push({ y: 690, fn: () => drawMeetingTable(985, 640) });
  items.push({ y: 735, fn: () => drawPlant(55, 710) });
  items.push({ y: 735, fn: () => drawPlant(1150, 710) });
  items.push({ y: 470, fn: () => drawPlant(905, 430) });
  for (const id in DESKS) {
    const e = ents[id], d = DESKS[id];
    const isSit = seated(e);
    items.push({ y: d.y + 34, fn: () => { drawWorkstation(id, now); if (isSit) drawSeated(e, now); } });
    if (!isSit) items.push({ y: e.y + 16, fn: () => drawWalking(e, now) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.fn();

  if (standup.active) drawStandupBanner(now);
}

/* ---- signal pipeline: Рынок → Стратег → Вход → Исполнение ---- */
function flowAnchor(id) { const d = DESKS[id]; return { x: d.x, y: d.y + 28 }; }
function drawSignalFlow(now) {
  ctx.save();
  for (let i = 0; i < PIPE.length - 1; i++) {
    const a = flowAnchor(PIPE[i]), b = flowAnchor(PIPE[i + 1]);
    const hot = ents[PIPE[i]].status === 'working' || ents[PIPE[i + 1]].status === 'working';
    ctx.setLineDash([5, 9]); ctx.lineDashOffset = -(now / 35) % 14;
    ctx.strokeStyle = hot ? 'rgba(54,208,255,0.55)' : 'rgba(54,208,255,0.12)';
    ctx.lineWidth = hot ? 2 : 1.2; line(a.x, a.y, b.x, b.y);
    ctx.setLineDash([]);
    arrowHead(a, b, hot ? '#36d0ff' : 'rgba(54,208,255,0.3)', 0.82);
    if (hot) for (const off of [0, 0.5]) {
      const k = (now / 1500 + off) % 1;
      ctx.fillStyle = '#36d0ff'; ctx.shadowColor = '#36d0ff'; ctx.shadowBlur = 8;
      circle(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 3); ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}
function arrowHead(a, b, color, t) {
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, 4.5); ctx.lineTo(-4, -4.5); ctx.closePath(); ctx.fill(); ctx.restore();
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

function drawStandupBanner(now) {
  const x = TABLE.x, y = TABLE.y - 86, pulse = 0.6 + 0.4 * Math.sin(now / 300);
  roundRect(x - 68, y - 15, 136, 26, 8); ctx.fillStyle = `rgba(255,207,90,${0.14 * pulse})`; ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#ffcf5a'; ctx.font = 'bold 12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('СТЕНДАП', x, y + 3);
}

function drawFloor() {
  ctx.fillStyle = '#0a1328'; ctx.fillRect(0, 0, W, H);
  // tiles
  ctx.strokeStyle = 'rgba(54,208,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 56) line(x, 150, x, H);
  for (let y = 150; y <= H; y += 56) line(0, y, W, y);
  // central rug under master
  const g = ctx.createRadialGradient(600, 460, 20, 600, 460, 280);
  g.addColorStop(0, 'rgba(54,208,255,0.10)'); g.addColorStop(1, 'rgba(54,208,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(600, 470, 260, 150, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.12)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(600, 470, 250, 142, 0, 0, 7); ctx.stroke();
}

function drawBackWall(now) {
  // wall
  ctx.fillStyle = '#0b1736'; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 142, W, 10);   // skirting shadow
  // windows with city skyline (left & right)
  drawWindow(40, 26, 300, 96, now);
  drawWindow(860, 26, 300, 96, now);
  // central video wall of market screens
  const vx = 372, vy = 20, vw = 456, vh = 112;
  roundRect(vx - 6, vy - 6, vw + 12, vh + 12, 8); ctx.fillStyle = '#060c1c'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  const cols = 3, gap = 10, sw = (vw - gap * (cols - 1)) / cols;
  for (let i = 0; i < cols; i++) miniChart(vx + i * (sw + gap), vy, sw, vh, i, now);
  ctx.fillStyle = 'rgba(54,208,255,0.6)'; ctx.font = 'bold 11px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('РЫНКИ · 24/7', vx + vw / 2, vy + vh + 14);
}

function drawWindow(x, y, w, h, now) {
  roundRect(x, y, w, h, 6); ctx.fillStyle = '#05102a'; ctx.fill();
  ctx.save(); ctx.clip();
  // sky glow
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#0a1f4a'); g.addColorStop(1, '#0a1230'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // skyline buildings + lit windows
  let bx = x + 6;
  let seed = Math.floor(x);
  while (bx < x + w - 6) {
    const bw = 16 + (seed % 20), bh = 24 + ((seed * 7) % 60); seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const by = y + h - bh;
    ctx.fillStyle = '#0c1d44'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,220,120,0.5)';
    for (let wy = by + 4; wy < y + h - 3; wy += 7)
      for (let wx = bx + 3; wx < bx + bw - 3; wx += 6)
        if (((wx * 13 + wy * 7 + Math.floor(now / 1700)) % 5) === 0) ctx.fillRect(wx, wy, 2, 3);
    bx += bw + 5;
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 2; roundRect(x, y, w, h, 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.strokeStyle = 'rgba(54,208,255,0.18)'; ctx.stroke();
}

function miniChart(x, y, w, h, idx, now) {
  roundRect(x, y, w, h, 4); ctx.fillStyle = '#081330'; ctx.fill();
  const up = (idx + Math.floor(now / 4000)) % 2 === 0;
  const col = up ? '#36e39a' : '#ff6b7a';
  ctx.strokeStyle = 'rgba(54,208,255,0.1)'; ctx.lineWidth = 1;
  for (let gy = y + 10; gy < y + h; gy += 14) line(x, gy, x + w, gy);
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const px = x + (i / 24) * w;
    const base = up ? (y + h - 8 - (i / 24) * (h - 20)) : (y + 10 + (i / 24) * (h - 20));
    const py = base + Math.sin(i * 0.8 + now / 500 + idx) * 6;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.shadowColor = col; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
}

/* ---- workstation (desk + monitor + chair) ---- */
function drawWorkstation(id, now) {
  const d = DESKS[id], e = ents[id], col = accentFor(id);
  const working = e.status === 'working', blocked = e.status === 'blocked';
  const w = d.big ? 150 : 104, h = d.big ? 30 : 24;
  const x = d.x - w / 2, y = d.y + 6;
  // chair (behind the person, i.e. above the desk seat)
  drawChair(d.x, d.y - 26);
  // desk: top face + front edge for depth
  ctx.fillStyle = '#16284a'; roundRect(x, y, w, h, 6); ctx.fill();
  ctx.fillStyle = '#0e1b36'; ctx.fillRect(x, y + h - 2, w, 8);
  ctx.strokeStyle = 'rgba(54,208,255,0.28)'; ctx.lineWidth = 1.2; roundRect(x, y, w, h, 6); ctx.stroke();
  // keyboard + mouse
  ctx.fillStyle = '#20304f'; roundRect(d.x - 20, y + h - 14, 40, 9, 2); ctx.fill();
  roundRect(d.x + 26, y + h - 13, 8, 7, 2); ctx.fill();
  // monitor(s) — screen faces viewer, mounted on the desk front
  const mw = d.big ? 92 : 58, mh = d.big ? 34 : 24, mx = d.x - mw / 2, my = y + h - 2;
  drawMonitor(mx, my, mw, mh, working, blocked, col, now, id);
  if (d.big) { // master gets a second side screen
    drawMonitor(mx + mw + 6, my + 6, 34, 22, working, blocked, col, now, id + '2');
    drawMonitor(mx - 40, my + 6, 34, 22, working, blocked, col, now, id + '3');
  }
}

function drawMonitor(x, y, w, h, on, blocked, col, now, seed) {
  // stand
  ctx.fillStyle = '#0b162c'; ctx.fillRect(x + w / 2 - 3, y + h, 6, 6); ctx.fillRect(x + w / 2 - 9, y + h + 6, 18, 3);
  // bezel
  roundRect(x, y, w, h, 3); ctx.fillStyle = '#0a1428'; ctx.fill();
  ctx.strokeStyle = blocked ? 'rgba(255,93,108,0.9)' : on ? col : 'rgba(54,208,255,0.3)';
  ctx.lineWidth = 1.5; ctx.stroke();
  // screen
  const sx = x + 2, sy = y + 2, sw = w - 4, sh = h - 4;
  if (blocked) { ctx.fillStyle = 'rgba(255,93,108,0.25)'; roundRect(sx, sy, sw, sh, 2); ctx.fill();
    ctx.fillStyle = '#ff6b7a'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('!', x + w / 2, y + h / 2 + 4); return; }
  ctx.fillStyle = on ? 'rgba(10,22,44,0.95)' : '#0c1730'; roundRect(sx, sy, sw, sh, 2); ctx.fill();
  if (on) {
    const hh = hash(String(seed));
    ctx.save(); roundRect(sx, sy, sw, sh, 2); ctx.clip();
    ctx.strokeStyle = (hh % 2 ? '#36e39a' : col); ctx.lineWidth = 1.3;
    ctx.shadowColor = col; ctx.shadowBlur = 5; ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const px = sx + (i / 16) * sw;
      const py = sy + sh / 2 + Math.sin(i * 0.9 + now / 350 + hh) * (sh / 3);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
  }
}

function drawChair(x, y) {
  ctx.fillStyle = '#16233f'; roundRect(x - 13, y - 2, 26, 20, 6); ctx.fill();   // back
  ctx.fillStyle = '#1d2d4d'; roundRect(x - 12, y + 12, 24, 10, 4); ctx.fill();  // seat
}

/* ---- people ---- */
function drawSeated(e, now) {
  const d = DESKS[e.id]; const x = d.x, y = d.y - 18;
  shadow(x, y + 20, 13);
  // torso (shirt)
  ctx.fillStyle = e.color; roundRect(x - 11, y - 2, 22, 22, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  // arms reaching to keyboard (typing bob when working)
  const t = e.status === 'working' ? Math.sin(now * 0.02) * 1.6 : 0;
  ctx.fillStyle = e.color;
  roundRect(x - 15, y + 8 + t, 7, 12, 3); ctx.fill();
  roundRect(x + 8, y + 8 - t, 7, 12, 3); ctx.fill();
  ctx.fillStyle = e.skin;                       // hands
  ctx.beginPath(); ctx.arc(x - 12, y + 20 + t, 3, 0, 7); ctx.arc(x + 12, y + 20 - t, 3, 0, 7); ctx.fill();
  drawHead(e, x, y - 12, 'down');
  emote(e, x, y - 30, now);
  nameplate(e, x, y + 30);
}

function drawWalking(e, now) {
  const x = e.x, y = e.y, f = e.facing;
  const walk = e.moving ? Math.sin(e.phase) : 0;
  shadow(x, y + 15, 11);
  // legs
  ctx.fillStyle = '#1b2b4d';
  roundRect(x - 6, y + 6 + walk * 2, 5, 11, 2); ctx.fill();
  roundRect(x + 1, y + 6 - walk * 2, 5, 11, 2); ctx.fill();
  // torso
  ctx.fillStyle = e.color; roundRect(x - 9, y - 10, 18, 20, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  // swinging arms
  ctx.fillStyle = e.color;
  roundRect(x - 12, y - 7 + walk * 2.5, 5, 13, 3); ctx.fill();
  roundRect(x + 7, y - 7 - walk * 2.5, 5, 13, 3); ctx.fill();
  ctx.fillStyle = e.skin;
  ctx.beginPath(); ctx.arc(x - 9.5, y + 5 + walk * 2.5, 2.6, 0, 7); ctx.arc(x + 9.5, y + 5 - walk * 2.5, 2.6, 0, 7); ctx.fill();
  drawHead(e, x + f * 1, y - 16, 'down');
  emote(e, x, y - 32, now);
  nameplate(e, x, y + 26);
}

function drawHead(e, x, y, dir) {
  // neck
  ctx.fillStyle = shade(e.skin, -25); ctx.fillRect(x - 3, y + 6, 6, 4);
  // face
  ctx.beginPath(); ctx.fillStyle = e.skin; ctx.arc(x, y, 7, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
  // hair styles
  ctx.fillStyle = e.hair;
  if (e.hairStyle === 0) { ctx.beginPath(); ctx.arc(x, y - 1, 7.4, Math.PI, 2 * Math.PI); ctx.fill(); ctx.fillRect(x - 7.2, y - 1, 2.4, 5); ctx.fillRect(x + 4.8, y - 1, 2.4, 5); }
  else if (e.hairStyle === 1) { ctx.beginPath(); ctx.arc(x, y - 2, 7.6, Math.PI, 2 * Math.PI); ctx.fill(); ctx.fillRect(x - 7.6, y - 2, 15.2, 3); }
  else { ctx.beginPath(); ctx.arc(x, y - 2, 7.2, Math.PI * 1.05, 2 * Math.PI * 0.98); ctx.fill(); }
  // eyes (facing viewer)
  ctx.fillStyle = '#14202f';
  ctx.beginPath(); ctx.arc(x - 2.4, y + 1, 1, 0, 7); ctx.arc(x + 2.4, y + 1, 1, 0, 7); ctx.fill();
}

function nameplate(e, x, y) {
  const label = SHORT[e.id] || e.id;
  ctx.font = '9px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 10;
  const st = e.status;
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
  else if (e.roamKind === 'desk') emoji = '🔎';
  roundRect(x - 12, y - 12 + bob, 24, 21, 7); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = brd; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 4, y + 8 + bob); ctx.lineTo(x, y + 13 + bob); ctx.lineTo(x + 4, y + 8 + bob); ctx.fillStyle = bg; ctx.fill();
  ctx.font = '13px serif'; ctx.textAlign = 'center'; ctx.fillText(emoji, x, y + 4 + bob);
}

/* ---- static props ---- */
function drawServerRack(x, y, now) {
  roundRect(x, y, 56, 108, 6); ctx.fillStyle = '#0d1b38'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const uy = y + 8 + i * 16;
    ctx.fillStyle = '#132547'; roundRect(x + 5, uy, 46, 12, 2); ctx.fill();
    // blinking LEDs
    for (let k = 0; k < 3; k++) {
      const on = ((i * 3 + k + Math.floor(now / 500)) % 4) !== 0;
      ctx.fillStyle = on ? (k === 0 ? '#36e39a' : '#36d0ff') : '#1c3254';
      ctx.beginPath(); ctx.arc(x + 12 + k * 7, uy + 6, 1.8, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(54,208,255,0.25)'; ctx.fillRect(x + 36, uy + 4, 11, 4);
  }
  ctx.fillStyle = 'rgba(54,208,255,0.75)'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('ЯДРО', x + 28, y + 122);
}

function drawCoffee(x, y) {
  roundRect(x - 16, y - 24, 32, 48, 5); ctx.fillStyle = '#17273f'; ctx.fill();
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#0a1428'; roundRect(x - 11, y - 18, 22, 10, 2); ctx.fill();   // display
  ctx.fillStyle = '#36e39a'; ctx.fillRect(x - 8, y - 15, 5, 4);
  ctx.fillStyle = '#20304f'; roundRect(x - 8, y + 2, 16, 10, 2); ctx.fill();      // cup slot
  ctx.fillStyle = '#eee'; roundRect(x - 5, y + 5, 10, 7, 2); ctx.fill();          // cup
  ctx.fillStyle = 'rgba(127,152,196,0.75)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Кофе', x, y + 36);
}

function drawWaterCooler(x, y) {
  roundRect(x - 13, y - 6, 26, 34, 4); ctx.fillStyle = '#17273f'; ctx.fill();     // body
  ctx.strokeStyle = 'rgba(54,208,255,0.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = 'rgba(54,208,255,0.5)'; roundRect(x - 9, y - 24, 18, 20, 6); ctx.fill(); // bottle
  ctx.fillStyle = 'rgba(54,208,255,0.3)'; ctx.fillRect(x - 3, y - 28, 6, 6);
  ctx.fillStyle = 'rgba(127,152,196,0.75)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Вода', x, y + 40);
}

function drawMeetingTable(x, y) {
  ctx.fillStyle = '#13233f';
  ctx.beginPath(); ctx.ellipse(x, y, 60, 30, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 60, 30, 0, 0, 7); ctx.stroke();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; drawChairSmall(x + Math.cos(a) * 78, y + Math.sin(a) * 44); }
  ctx.fillStyle = 'rgba(255,207,90,0.6)'; ctx.font = '10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Переговорная', x, y + 56);
}
function drawChairSmall(x, y) { ctx.fillStyle = '#1b2b4d'; roundRect(x - 7, y - 7, 14, 14, 4); ctx.fill(); }

function drawPlant(x, y) {
  ctx.fillStyle = '#153b2b'; ctx.beginPath();           // leaves
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.5; ctx.ellipse(x + Math.cos(a) * 10, y - 14 + Math.sin(a) * 8, 7, 13, a, 0, 7); }
  ctx.fill();
  ctx.fillStyle = '#2aa06a'; ctx.beginPath();
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.5; ctx.ellipse(x + Math.cos(a) * 8, y - 16 + Math.sin(a) * 6, 5, 10, a, 0, 7); }
  ctx.fill();
  ctx.fillStyle = '#7a5433'; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.lineTo(x + 6, y + 14); ctx.lineTo(x - 6, y + 14); ctx.closePath(); ctx.fill(); // pot
}

/* ---- tiny helpers ---- */
function shadow(x, y, r) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.38, 0, 0, 7); ctx.fill(); }
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

window.Office = Office;

})();
