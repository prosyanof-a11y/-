# Agent Office — Build Guide

Opinionated, minimal paths to a working office. Pair with
`architecture.md` (concepts) and `landscape.md` (what to fork). Skeletons are
illustrative contracts, not full apps — keep the brain/state/view boundaries
from `architecture.md` as you flesh them out.

---

## A. Observability office (watch REAL agents) — fastest path

Goal: your real coding agents (Claude Code / Codex / CI) show up as characters.

**Stack:** Node or FastAPI backend · WebSocket · PixiJS + React/Zustand ·
in-memory state (no DB needed).

### 1. The event contract (what the brain receives)

One endpoint for status, one for one-shot events, plus native hooks.

```
POST /api/status   { "agent": "dev-1", "role": "developer",
                     "status": "working", "action": "edit",
                     "detail": "refactoring auth", "workflow": "Sprint 42" }

POST /api/event    { "agent": "ops-1", "role": "devops",
                     "kind": "shipped", "detail": "deployed v4.1.1" }
```

### 2. Wire Claude Code hooks → status

Register hooks once (ship an installer that writes `.claude/settings.json` hook
entries) so there's zero manual setup. Map events honestly:

```
SessionStart        → status: idle,    action: arrive
UserPromptSubmit    → status: thinking, action: plan
PreToolUse(Edit)    → status: working,  action: edit
PreToolUse(Bash)    → status: working,  action: run     (role-specialize: QA→test, Ops→deploy)
PostToolUse(error)  → status: blocked,  blocked_reason: <reason>
Stop / idle 45s     → status: idle,     action: think
deploy/merge success→ event kind: shipped  → celebration
```

Each hook does one `curl -s -X POST localhost:PORT/api/status -d '{...}'`.
Optionally gate a capture mode that also appends the raw hook JSON to a JSONL file
for building test fixtures.

### 3. State owner + WebSocket (Node sketch)

```js
// state.js — single source of truth
const world = { seq: 0, agents: new Map(), zones: defaultZones(), log: [] };
function applyStatus(s) {
  const a = world.agents.get(s.agent) ?? newAgent(s);
  Object.assign(a, pick(s, ["role","status","action","detail","blocked_reason"]));
  if (s.status === "working") a.target = a.deskZone;        // walk to desk
  world.seq++; broadcast();                                 // one update per change
}
// server.js — WS push
wss.on("connection", ws => ws.send(snapshot()));
function broadcast(){ const f = snapshot(); for (const c of wss.clients) c.send(f); }
function snapshot(){ return JSON.stringify({ seq: world.seq,
  agents: [...world.agents.values()], zones: world.zones, log: world.log.slice(-50) }); }
```

### 4. Renderer (PixiJS + Zustand sketch)

```ts
// store.ts — client mirror of world state, updated once per WS frame
const useWorld = create<World>(() => emptyWorld);
ws.onmessage = e => { const f = JSON.parse(e.data);
  if (f.seq > useWorld.getState().seq) useWorld.setState(f); };   // drop stale frames

// render loop — presentation only, derived from state
app.ticker.add(() => {
  for (const a of useWorld.getState().agents) {
    const spr = spriteFor(a);                 // by role
    walkToward(spr, a.pos, a.target);         // A* path precomputed on target change
    setAnim(spr, a.role, a.action);           // animation by role+action
    setBubble(spr, a.status, a.blocked_reason);
  }
});
```

Then add the overlay (activity log, click-to-inspect), zones, and ambient events
that back off when `agents` show live `working` state.

---

## B. Generative office (AUTONOMOUS agents) — the simulation path

Goal: LLM-driven characters that live, work, and collaborate on their own.

**Stack:** Node+TS or FastAPI · Colyseus (rooms) **or** Convex (state+vector) ·
PixiJS/Phaser (or Three.js for 3D) · SQLite/Convex for memory · Ollama or
OpenAI-compatible adapter · Tiled map.

### 1. Agent decision contract (what the LLM returns each tick)

```jsonc
{
  "thought": "QA is blocked on my PR; I should go explain the auth change.",
  "action": "talk",                 // move | talk | use_tool | idle | hire
  "target": "qa-1",                 // agentId or zoneId or {x,y}
  "toolCall": null                  // {name, args} when action = use_tool
}
```

Validate server-side; a malformed response falls back to `idle` — never crash the
tick.

### 2. The tick loop (per agent, staggered)

```python
async def tick(agent, world):
    perception = perceive(agent, world)          # nearby agents/objects/zone + plan step
    memories   = retrieve(agent, query=perception, k=8)   # recency·importance·relevance
    decision   = await llm.decide(agent.persona, perception, memories)  # structured JSON
    apply(world, agent, decision)                # move→set target; talk→needs proximity
    remember(agent, observe(decision, world))    # append observation (+importance)
    if due_to_reflect(agent): reflect(agent)     # synthesize higher-level insights
```

Tick every ~10–15s; stagger agents so you don't burst the LLM. `apply` is the only
place world state changes (single writer).

### 3. Memory (SQLite + embeddings)

```
memories(id, agent_id, ts, text, importance INT, embedding BLOB, last_access)
retrieve: score = norm(recency_decay) + norm(importance) + cosine(query_emb, emb)
          → ORDER BY score DESC LIMIT k
reflect : when sum(recent importance) > T → LLM summarizes → insert as high-importance memory
```

Model + embeddings behind one adapter interface (`decide()`, `embed()`,
`rate_importance()`) so Ollama ↔ OpenAI is a config swap.

### 4. Map & movement

Author the office in **Tiled** (walkable layer + zone objects), export JSON,
convert to your grid. A* between cells; proximity gates conversations.

---

## C. Going 3D

Keep the entire brain + state layer from A or B. Replace only `view/`:
- **Browser:** Three.js (WebGPU for scale) — isometric or free camera, glTF
  character models, the same grid as a navmesh, the same bubbles as sprites in
  screen space. (See CLAW3D, agents-home.)
- **Native:** Godot 4 — characters as scenes, an HTTP/WS client that reads the same
  snapshot, decisions still come from your server/LLM. (See aphae.)

Build 2D first to prove the loop; 3D is a second renderer, not a rewrite.

---

## D. Definition of done — checklist

- [ ] World-state snapshot is small, serializable, `seq`-ordered.
- [ ] Server owns truth; renderer is a pure function of state (no invented status).
- [ ] Observability: every visible state traces to a real signal; idle = silence-timeout.
- [ ] Generative: ticks (not frames) drive the LLM; decisions are structured; bad output → idle.
- [ ] Memory (generative): stream + importance + retrieval + reflection + planning.
- [ ] Spatial: grid + zones + A* + proximity-gated interaction.
- [ ] Visuals: sprite by role, animation by action, status/blocked bubbles, activity log.
- [ ] Ambient life backs off during real work; `prefers-reduced-motion` honored.
- [ ] Model behind a swappable adapter; office still renders with no key (clear badge).
- [ ] Persistence for what must survive restart; reproducible via seeds + event log.
