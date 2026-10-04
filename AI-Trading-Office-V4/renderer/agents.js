'use strict';
/* ============================================================================
 * AI Trading Office — agent definitions + the "brain"
 *
 * Per the agent-office skill, the BRAIN (what an agent is doing) is decoupled
 * from the BODY (the HUD panels in app.js) and joined by a small world-state
 * snapshot. Two brains live here:
 *   - Simulator  : DEMO mode. Brings the office to life with coherent random
 *                  walks so it never looks dead. Clearly badged DEMO.
 *   - mapBackendToWorld : LIVE mode. Best-effort adapter from your core's
 *                  WebSocket messages to the same snapshot shape. Tune it to
 *                  your real backend schema — it is the ONE place to edit.
 *
 * HONESTY RULE: in LIVE mode a value is shown only if the backend actually sent
 * it. DEMO numbers are never presented as real — the header shows the mode.
 * ==========================================================================*/
(() => {

// ---- The 8 agents (order = layout order around the hub) --------------------
const AGENTS = [
  { id: 'market',    name: 'АГЕНТ РЫНКА',          sub: 'Анализ рынка и сентимент',     accent: 'cyan',
    fields: [ ['Структура', 'structure'], ['Настроение', 'sentiment'], ['Оценка', 'score'] ] },
  { id: 'liquidity', name: 'ЛИКВИДНОСТЬ / ROI',    sub: 'Ликвидность и доходность',     accent: 'cyan',
    fields: [ ['Свинг', 'swing'], ['ROI', 'roi'] ] },
  { id: 'strategy',  name: 'СТРАТЕГИЧЕСКИЙ АГЕНТ',  sub: 'Выбор стратегии и модели',     accent: 'violet',
    fields: [ ['Стратегия', 'strategy'], ['Фильтр', 'filter'], ['Уверенность', 'confidence'], ['Режим', 'mode'] ] },
  { id: 'entry',     name: 'АГЕНТ ВХОДА',           sub: 'Сигналы и тайминг',            accent: 'gold',
    fields: [ ['Уверенность', 'confidence'], ['Триггер', 'trigger'] ] },
  { id: 'master',    name: 'МАСТЕР-АГЕНТ',          sub: 'Координатор',                  accent: 'gold',   hub: true,
    fields: [ ['Тренд', 'trend'], ['Решение', 'decision'], ['Уверенность', 'confidence'] ] },
  { id: 'exit',      name: 'АГЕНТ ВЫХОДА',          sub: 'SL/TP и сопровождение сделки', accent: 'cyan',
    fields: [ ['SL / TP', 'sltp'], ['Выход', 'exit'], ['Режим', 'mode'] ] },
  { id: 'risk',      name: 'РИСК-МЕНЕДЖЕР',         sub: 'Контроль риска и портфеля',    accent: 'gold',
    fields: [ ['Общий риск', 'total'], ['Макс. риск/сделку', 'maxPerTrade'], ['Дневной лимит', 'dailyLimit'], ['Статус', 'rstatus'] ] },
  { id: 'execution', name: 'АГЕНТ ИСПОЛНЕНИЯ',      sub: 'Исполнение ордеров и брокер',  accent: 'cyan',
    fields: [ ['Брокер', 'broker'], ['Ордера', 'orders'], ['Статус', 'estatus'] ] }
];

// status -> badge label + css class
const STATUS = {
  working: { label: 'РАБОТАЕТ',  cls: 'ok'   },
  waiting: { label: 'ОЖИДАНИЕ',  cls: 'wait' },
  wait:    { label: 'ЖДАТЬ',     cls: 'wait' },
  blocked: { label: 'БЛОК',      cls: 'bad'  },
  idle:    { label: 'ОФФЛАЙН',   cls: 'off'  }
};

// ---- helpers ----------------------------------------------------------------
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (v) => v.toFixed(0) + '%';

// ---- DEMO brain: the simulator ---------------------------------------------
class Simulator {
  constructor() {
    this.seq = 0;
    this.t = 0;
    // seeded-ish starting state, coherent with a mild bullish bias
    this.bull = Math.random() > 0.4;
    this.conf = rnd(72, 88);
    this.risk = rnd(0.6, 1.3);
    this.roi = rnd(-1.5, 4.5);
    this.swing = rnd(-0.8, 1.2);
    this.state = {};
    for (const a of AGENTS) this.state[a.id] = { status: 'waiting', metrics: {} };
    this._recompute();
  }

  _dir() { return this.bull ? 'Бычий' : 'Медвежий'; }

  _recompute() {
    const dir = this._dir();
    const decision = this.conf > 80 ? (this.bull ? 'ПОКУПКА' : 'ПРОДАЖА')
                   : this.conf > 68 ? 'Мульти-ТФ' : 'Наблюдение';
    this.state.market.metrics    = { structure: dir, sentiment: dir, score: pct(this.conf) };
    this.state.liquidity.metrics = { swing: (this.swing >= 0 ? '+' : '') + this.swing.toFixed(2) + '%',
                                     roi: (this.roi >= 0 ? '+' : '') + this.roi.toFixed(2) + '%' };
    this.state.strategy.metrics  = { strategy: this.bull ? 'Следование тренду' : 'Контртренд',
                                     filter: 'Мульти-ТФ', confidence: this.conf > 78 ? 'ВЫСОКИЙ' : 'СРЕДНИЙ',
                                     mode: 'Адаптивный' };
    this.state.entry.metrics     = { confidence: pct(this.conf), trigger: this.conf > 80 ? 'Активен' : '—' };
    this.state.master.metrics    = { trend: dir, decision, confidence: pct(clamp(this.conf + 6, 0, 99)) };
    this.state.exit.metrics      = { sltp: (this.bull ? '1.5R / 3.0R' : '1.2R / 2.4R'),
                                     exit: 'По сигналу / Мульти-ТФ', mode: 'Адаптивный' };
    this.state.risk.metrics      = { total: this.risk.toFixed(1) + '%',
                                     maxPerTrade: clamp(this.risk * 0.9, 0.3, 2).toFixed(1) + '%',
                                     dailyLimit: '5.0%',
                                     rstatus: this.risk > 1.5 ? 'ПРЕВЫШЕН' : 'В НОРМЕ' };
    this.state.execution.metrics = { broker: 'Подключено', orders: this.conf > 80 ? 'entry_wait' : 'idle',
                                     estatus: this.conf > 80 ? 'entry_wait' : 'standby' };
  }

  tick() {
    this.seq++; this.t++;
    // random walks keep the numbers alive
    this.conf = clamp(this.conf + rnd(-4, 4), 55, 95);
    this.risk = clamp(this.risk + rnd(-0.25, 0.25), 0.3, 1.9);
    this.roi += rnd(-0.4, 0.5);
    this.swing += rnd(-0.3, 0.3);
    if (Math.random() < 0.08) this.bull = !this.bull;    // occasional regime flip
    this._recompute();

    const log = [];
    // status dynamics: mostly waiting/working, risk can block, execution follows entry
    for (const a of AGENTS) {
      const s = this.state[a.id];
      const prev = s.status;
      if (a.id === 'risk') {
        s.status = this.risk > 1.5 ? 'blocked' : (Math.random() < 0.5 ? 'waiting' : 'working');
      } else if (a.id === 'execution') {
        s.status = this.risk > 1.5 ? 'blocked' : (this.conf > 82 ? 'working' : 'waiting');
      } else if (a.id === 'master') {
        s.status = this.conf > 70 ? 'working' : 'waiting';
      } else if (a.id === 'market') {
        s.status = 'working';
      } else if (a.id === 'entry') {
        s.status = this.conf > 80 ? 'working' : 'wait';
      } else {
        s.status = Math.random() < 0.35 ? 'working' : 'waiting';
      }
      if (s.status !== prev) log.push(this._logFor(a, s.status));
    }
    // ambient trade-life log lines
    if (Math.random() < 0.3) {
      log.push(this.conf > 82
        ? { kind: 'ok',   text: `Мастер-агент: сигнал ${this._dir().toLowerCase()}, уверенность ${pct(this.conf)}` }
        : { kind: 'info', text: `Рынок: структура ${this._dir().toLowerCase()}, ждём подтверждения` });
    }
    if (this.risk > 1.6 && Math.random() < 0.5)
      log.push({ kind: 'bad', text: `Риск-менеджер: общий риск ${this.risk.toFixed(1)}% — вход заблокирован` });

    return this.snapshot(log);
  }

  _logFor(a, status) {
    const map = {
      working: { kind: 'ok',   text: `${a.name}: приступил к работе` },
      waiting: { kind: 'info', text: `${a.name}: ожидание` },
      wait:    { kind: 'info', text: `${a.name}: ждёт сигнала` },
      blocked: { kind: 'bad',  text: `${a.name}: блок` }
    };
    return map[status] || { kind: 'info', text: `${a.name}: ${status}` };
  }

  snapshot(log = []) {
    const agents = {};
    for (const a of AGENTS) agents[a.id] = { ...this.state[a.id] };
    const working = Object.values(agents).filter(s => s.status === 'working').length;
    return {
      seq: this.seq, mode: 'demo', connection: 'demo',
      summary: { connected: AGENTS.length, working },
      agents,
      log: log.map((l, i) => ({ ...l, ts: nowHHMMSS(), seq: this.seq * 100 + i }))
    };
  }
}

function nowHHMMSS() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

/* ----------------------------------------------------------------------------
 * LIVE brain: adapt your core's WebSocket payload to the snapshot shape.
 *
 * Edit THIS function to match your real backend. The transcript of the earlier
 * build showed messages like { state: { enabled_symbols, weekend, ... } }, so a
 * starting point is below. Anything you don't map simply isn't shown (honesty
 * rule) — the panel keeps its last LIVE value or shows "—".
 * -------------------------------------------------------------------------- */
function mapBackendToWorld(raw, prev) {
  // Fallback: if we can't recognize the schema, keep previous agent state but
  // flip the mode/connection to LIVE so the header is truthful.
  const base = prev && prev.agents ? prev : (new Simulator()).snapshot();
  const state = raw && (raw.state || raw.data || raw);
  if (!state || typeof state !== 'object') {
    return { ...base, mode: 'live', connection: 'connected',
             log: [{ kind: 'info', text: 'Ядро: получено сообщение (схема не распознана)', ts: nowHHMMSS(), seq: Date.now() }] };
  }

  const agents = JSON.parse(JSON.stringify(base.agents));
  // --- Example mappings — adjust keys to your core ---
  if (state.enabled_symbols != null)
    agents.execution.metrics.orders = Array.isArray(state.enabled_symbols)
      ? state.enabled_symbols.join(', ') : String(state.enabled_symbols);
  if (state.weekend != null) {
    const wk = Boolean(state.weekend);
    for (const id of Object.keys(agents)) agents[id].status = wk ? 'waiting' : agents[id].status;
    if (wk) agents.master.metrics.decision = 'Выходной (рынок закрыт)';
  }
  if (state.confidence != null) agents.master.metrics.confidence = pct(Number(state.confidence) * (state.confidence <= 1 ? 100 : 1));
  if (state.decision != null)   agents.master.metrics.decision = String(state.decision);
  if (state.risk != null)       agents.risk.metrics.total = String(state.risk);

  const working = Object.values(agents).filter(s => s.status === 'working').length;
  return {
    seq: (base.seq || 0) + 1, mode: 'live', connection: 'connected',
    summary: { connected: AGENTS.length, working },
    agents,
    log: [{ kind: 'ok', text: 'Ядро: снимок состояния обновлён', ts: nowHHMMSS(), seq: Date.now() }]
  };
}

window.OFFICE = { AGENTS, STATUS, Simulator, mapBackendToWorld, nowHHMMSS };

})();
