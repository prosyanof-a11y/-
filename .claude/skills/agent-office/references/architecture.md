# Agent Office — Architecture Reference

Everything here hangs off the core principle in `SKILL.md`: **brain and body are
decoupled and joined by a single authoritative world state synced to the
renderer.** This file is the full blueprint for both modes.

## Table of contents

1. Component architecture (both modes)
2. The world-state snapshot
3. Sync mechanism — decision guide
4. Observability brain: signals → honest state
5. Generative brain: perceive → think → act
6. The memory model (Stanford Generative Agents)
7. Spatial model: grid, zones, pathfinding, proximity
8. State → visual mapping
9. Tech-stack matrix
10. Scaling, cost, and failure modes

---

## 1. Component architecture (both modes)

```
            ┌──────────────────────────────────────────────┐
            │                 STATE OWNER                    │
            │  (server / reactive DB — single source of      │
            │   truth; ACID/transactional if possible)       │
            │                                                 │
            │   world = { agents[], zones[], objects[],       │
            │             tick/seq, log[] }                   │
            └───────▲───────────────────────────┬────────────┘
                    │ apply decisions / events   │ push snapshot on change/tick
                    │                            ▼
   ┌────────────────┴───────┐        ┌───────────────────────────┐
   │        BRAIN           │        │          BODY             │
   │ observability: adapters│        │ renderer (2D/3D) reads     │
   │   that ingest hook/HTTP │        │ state, interpolates,       │
   │   signals               │        │ pathfinds, animates,       │
   │ generative: tick loop + │        │ draws bubbles/emotes       │
   │   LLM + memory + tools  │        │ + UI overlay (log,         │
   └────────────────────────┘        │   inspector, task board)   │
                    ▲                 └───────────────┬───────────┘
                    │ tool calls / retrieval          │ clicks, camera
                    ▼                                  ▼
            ┌───────────────┐                   ┌───────────────┐
            │ LLM + tools +  │                   │     USER       │
            │ memory store   │                   │                │
            └───────────────┘                   └───────────────┘
```

The three boxes map to three codebase boundaries you should keep clean:
`brain/` (or `adapters/`), `state/` (the owner + schema), and `view/` (renderer +
UI). A new dimension (3D) is a new `view/`; a new agent source is a new adapter.

---

## 2. The world-state snapshot

Keep it **small, serializable, and renderer-agnostic**. This is the contract
between brain and body. A minimal, sufficient shape:

```jsonc
{
  "seq": 1024,                       // monotonic tick/sequence for ordering
  "agents": [
    {
      "id": "dev-1",
      "name": "Ada",
      "role": "developer",           // drives sprite + role-specific emotes
      "pos": { "x": 12, "y": 7 },    // grid coords (authoritative)
      "target": { "x": 20, "y": 3 }, // where they're walking (view interpolates)
      "status": "working",           // working|blocked|shipped|idle|talking|thinking
      "action": "edit",              // current tool/verb → animation + emote
      "detail": "Refactoring auth",  // short human-readable line
      "blocked_reason": null,        // e.g. "api-rate-limit" when status=blocked
      "bubble": null,                // speech/thought text, or null
      "partnerId": null              // who they're talking to, for proximity
    }
  ],
  "zones": [                         // semantic places; static or rarely changing
    { "id": "desk-1", "kind": "desk", "rect": [10,6,2,2], "ownerId": "dev-1" },
    { "id": "coffee", "kind": "coffee", "rect": [30,2,2,2] }
  ],
  "log": [ { "seq": 1023, "text": "Ada shipped PR #42", "kind": "ship" } ]
}
```

Rules of thumb:
- **Positions are grid cells**, not pixels — the renderer scales. Movement between
  cells is interpolated client-side.
- **`status` is a small enum**; `action` is the finer verb that selects the
  animation/emote. Don't overload one field.
- Push **deltas** when the agent count is large; full snapshots are fine for the
  typical < 50-agent office.

---

## 3. Sync mechanism — decision guide

Pick the lightest thing that meets the need. All of these are proven in shipped
offices:

| Need | Use | Why |
|---|---|---|
| Simplest observability, one viewer, localhost | **HTTP push + in-memory state + SSE or short poll** | zero infra; agent-virtual-office runs with "no backend, no DB, no WebSocket" |
| Live bidirectional, multiple viewers | **WebSocket** (FastAPI/`ws`/Socket.IO) | push state on change; claude-office uses FastAPI WS → PixiJS |
| Room-based multiplayer, authoritative server state sync | **Colyseus** | schema-based state auto-syncs to all clients; AgentOffice uses it |
| Rich simulation with transactions + vector memory in one place | **Convex** | "game engine, database, and vector search"; AI Town is built on it |

Guidance:
- Batch per-tick writes into **one** state update per tick (claude-office:
  "per-frame agent writes batched into one store update per tick"). Many small
  writes thrash the client.
- Give each state update a **monotonic `seq`** so the client can drop stale/out-of-
  order frames — matters once you have movement + delegation in flight.
- Prefer **single-writer ownership** of each agent's state over timeout watchdogs;
  it removes a class of flicker bugs during movement/handoff.

---

## 4. Observability brain: signals → honest state

The brain here is thin: ingest real signals, map to state, never invent.

**Signal sources (in order of fidelity):**
1. **Agent-native hooks** — Claude Code fires `SessionStart/End`, `UserPromptSubmit`,
   `PreToolUse`/`PostToolUse`, `SubagentStart/Stop`, `Stop`, `PermissionRequest`,
   context-compaction. These are the richest, truest signal. Register them once
   (e.g. an installer that writes the hook config) so there's no manual setup.
2. **Universal HTTP API** — expose `POST /api/status` (role → state, e.g.
   `{"dev":"working","workflow":"Sprint 42"}`) and `POST /api/event` (one-shot:
   shipped, blocked). Lets Codex CLI, Gemini CLI, CI/GitHub Actions, or any script
   drive a character with a `curl`.

**Honest classification (the quality bar):**
- `working` — a tool is executing (from `PreToolUse`/post events).
- `blocked` — an operation failed with a reason: `api-rate-limit`,
  `permission-denied`, unresolved build/test failure. Surface the reason; mark
  repeats distinctly.
- `shipped` — a successful deploy/merge/PR event → a celebration beat.
- `idle` — **after N seconds of silence** (e.g. 45s), render as *thinking*, not
  *stuck*. Silence is not an event; treat it as such.

> The rule: **state updates only when a real signal arrives.** Everything the user
> sees must be traceable to one. Offer a capture/log mode (append raw hook events
> to a JSONL file) so you can build fixtures and prove the mapping is faithful.

---

## 5. Generative brain: perceive → think → act

Autonomous characters run a **tick loop** (~10–15s per agent; stagger to spread
load), each tick:

1. **Perceive** — gather nearby agents, objects, zone, recent events, and the
   agent's current plan step.
2. **Retrieve** — pull the top-k relevant memories (see §6) for this situation.
3. **Think** — one LLM call returns a **structured** decision:
   `{ thought, action, target, toolCall? }` where `action ∈ {move, talk, use_tool,
   idle, hire, ...}`.
4. **Act** — the *server* validates and applies the action to world state (move
   sets `target`; talk requires proximity; use_tool runs through a sandboxed
   `ToolExecutor`). The client then animates the result.
5. **Remember** — write an observation memory of what happened; periodically
   **reflect** and **re-plan**.

Keep the LLM **out of the render loop** — think on ticks, draw on frames. Structure
the output (JSON / tool-call) so parsing is deterministic and a bad response fails
safely to `idle` rather than crashing the tick.

Tools worth giving agents (sandboxed): code execution, web search, note/file
read-write, task creation, and — for emergent org behavior — *hiring* new agents.
Gate anything with side effects behind isolation.

---

## 6. The memory model (Stanford Generative Agents)

This is what makes generative agents feel coherent rather than goldfish-like.
Three layers:

**a) Memory stream.** An append-only list of observations, each with a timestamp
and an **importance** score (ask the LLM to rate 1–10 how poignant the memory is).
Store the text plus an embedding.

**b) Retrieval.** To build context for a decision, score every candidate memory and
take the top-k. The classic scoring is a weighted sum of three normalized signals:

```
score = α · recency + β · importance + γ · relevance
  recency   = exponential decay since last access (e.g. decay^hours)
  importance= the stored 1–10 poignancy (normalized)
  relevance = cosine similarity(query_embedding, memory_embedding)
# A common default is α = β = γ = 1; tune per world.
```

**c) Reflection.** Periodically (e.g. when summed recent importance crosses a
threshold), ask the LLM to synthesize higher-level insights from recent memories
("Ada keeps unblocking the QA agent → Ada is becoming the team's go-to reviewer").
Write reflections back into the stream as high-importance memories. **Planning**
works the same way: generate a day/sprint plan, store it, and let each tick consume
the next step, re-planning when reality diverges.

Implementation: SQLite + an embeddings call (e.g. `mxbai-embed-large` locally) is
enough; Convex or Pinecone if you want vector search managed. Importance-weighted
recall + semantic search is the combination every strong project uses.

---

## 7. Spatial model: grid, zones, pathfinding, proximity

- **Tile grid.** The office is a 2D grid (even a 3D office usually has a grid-based
  navmesh underneath). Author it in **Tiled** and export; AI Town converts Tiled
  maps via a small script. Grid cells carry walkable/blocked + zone tags.
- **Zones.** Semantic regions — desks (often owned by one agent), coffee machine,
  whiteboard, meeting table, lounge. Zones are *destinations* for actions and the
  anchors for ambient events.
- **Pathfinding.** **A\*** over the grid between the agent's cell and its target
  zone. Compute the path when `target` changes; the renderer walks it, interpolating
  between cells. Never pathfind per frame.
- **Proximity gating.** Interactions require the agents to be adjacent/within a
  radius. This makes conversations legible ("they walked over to talk"), bounds
  LLM calls (only co-located agents converse), and prevents spooky action at a
  distance.

---

## 8. State → visual mapping

The renderer turns `status`/`action`/`role` into what the user sees:

- **Sprite/model** chosen by `role` (developer, PM, QA, DevOps, designer,
  researcher, architect, gatekeeper…).
- **Animation** chosen by `action` — walking, typing at desk, writing on the
  whiteboard, pouring coffee. Reuse one animation system parameterized by
  role+action rather than bespoke code per character.
- **Status bubble / emote** for instant readcallability: 💻 coding, 💬 talking,
  😌 thinking, 🔧 tool use, 🚶 moving, 💡 idea, 🧪 test (QA), 🔨 deploy (Ops),
  📦 install (Architect). A blocked agent shows the reason.
- **Speech vs. thought bubbles** — dialogue vs. internal monologue, visually
  distinct.
- **Ambient life** — stand-ups, tea breaks, food arrivals, eureka moments on
  timers — but they must **back off when a live/real action is happening** so the
  office never "talks over" real work. On timers, use independent (Poisson-like)
  firing so the rhythm feels organic, not metronomic.
- **Accessibility** — honor `prefers-reduced-motion`, keep text legible at small
  sizes, make it responsive so it fills an IDE sidebar or a full window with no
  dead gutters.

---

## 9. Tech-stack matrix

| Layer | Lightweight | Common | Rich |
|---|---|---|---|
| 2D renderer | SVG + `requestAnimationFrame` | **PixiJS** (pixel sprites) / Canvas | **Phaser** (tilemaps, physics) |
| 3D renderer | — | **Three.js** | Three.js **WebGPU** / **Godot 4** |
| UI overlay | React + Zustand | React + Zustand | React + Zustand |
| State sync | HTTP + SSE | **WebSocket** | **Colyseus** / **Convex** |
| Backend | Node or FastAPI | FastAPI / Node+TS | Node+TS / Convex |
| Persistence | JSON/SQLite | SQLite | Convex / Postgres + pgvector |
| LLM | Ollama (local) | OpenAI-compatible adapter | multi-provider behind one interface |
| Embeddings | `mxbai-embed-large` (Ollama) | OpenAI embeddings | managed vector DB |
| Map authoring | hand-coded grid | **Tiled** → export | Tiled + custom objects |

Default starter for most requests: **PixiJS + React/Zustand + WebSocket +
FastAPI/Node + SQLite + Ollama/OpenAI adapter + Tiled map.** Light, proven, and
every piece is swappable.

---

## 10. Scaling, cost, and failure modes

- **LLM cost dominates** generative offices. Control it with: longer ticks,
  staggered scheduling, proximity-gated conversations, cheap/local models for
  routine decisions, and caching reflections/plans. Never call the LLM per frame.
- **Idle-but-alive.** With no model key or during rate limits, keep the office
  rendering and characters moving; show a clear "not configured / rate-limited"
  badge. A frozen scene reads as "broken".
- **State flicker** during movement/handoff → use monotonic `seq`, single-writer
  ownership, and batched per-tick updates (see §3).
- **Dishonest state** is the cardinal observability bug → the §4 rule: no signal,
  no change.
- **Pathfinding thrash** on crowded grids → cache paths, recompute only on target
  change or blockage.
- **Determinism for tests** → seed procedural generation (personalities, layout)
  and log raw events so runs are reproducible and gradeable.
