# Agent Office — Landscape (prior art to borrow from)

Surveyed projects, grouped by family, with what to take and what to avoid. Links
were valid at authoring time; re-check for the current best-in-class before forking.

## Family 1 — Observability offices (visualize REAL agents)

The brain is thin: ingest real signals, render honest state. Best starting point
when the user wants to *watch their actual agents work*.

- **agent-virtual-office** (KbWen) — https://github.com/KbWen/agent-virtual-office
  Pixel coworkers for Claude Code / Codex / Gemini. Hooks → HTTP status → SVG +
  React 19 + Zustand, **no backend/DB/WebSocket**. The gold standard for the
  *honesty* principle ("an agent's status is never made up"), state classification
  (working/blocked+reason/shipped/idle-after-45s), one-command hook setup, ambient
  life that backs off during real work, PNG export. **Borrow:** the whole
  signal→state→view honesty model and the HTTP `/api/status` + `/api/event` contract.
- **claude-office** (paulrobello) — https://github.com/paulrobello/claude-office
  FastAPI + **WebSocket** → Next.js + **PixiJS**, Zustand (split atomic stores),
  A* pathfinding, hooks for the full Claude Code lifecycle, batched per-tick writes,
  single-writer state ownership. **Borrow:** the WS architecture, event discrimination,
  and the anti-flicker patterns.
- **pixel-agents** (VS Code extension), **pixtuoid**, **the-agents-hub**,
  **my-virtual-office** (eliautobot), **pixel-office-openclaw** — variations on the
  same theme (terminal/IDE-embedded pixel office for coding agents). **Borrow:**
  embedding patterns (IDE sidebar), per-session character spawning.

## Family 2 — Generative-agent worlds (AUTONOMOUS agents)

The brain is heavy: a perceive→think→act loop with memory. Best when the user wants
*emergent* behavior, not a view of real work.

- **Generative Agents: Interactive Simulacra of Human Behavior** (Stanford/Google,
  Park et al. 2023) — the foundational paper. **Borrow:** memory stream, retrieval =
  recency·importance·relevance, reflection, planning. This is the canonical model;
  cite and implement it.
- **AI Town** (a16z-infra) — https://github.com/a16z-infra/ai-town
  Open-source Smallville. **Convex** (game engine + DB + vector search) + **PixiJS** +
  Ollama/OpenAI, Tiled maps via `convertMap.js`, MIT. **Borrow:** Convex as a
  one-stop transactional+vector backend; the data model (`data/characters.ts`);
  the map pipeline.
- **AgentOffice / "aphae-style" pixel offices** (e.g. harishkotra/agent-office) —
  https://github.com/harishkotra/agent-office
  Self-growing teams: **Phaser** + React + **Colyseus** + SQLite embeddings,
  Perceive→Think→Act (~15s), `{thought,action,target,toolCall}`, sandboxed
  ToolExecutor, agents that **hire** teammates, importance-weighted recall.
  **Borrow:** the structured decision contract, Colyseus room sync, the hiring
  mechanic for emergent org behavior.
- **aphae** (rsanandres) — https://github.com/rsanandres/aphae — **Godot 4** + Ollama,
  procedurally generated personalities/backstories. **Borrow:** native-app renderer
  over the same brain; procedural persona seeding.
- **Agent-Worlds / agents-home** — MCP-aware NPC worlds; **agents-home** is **Three.js
  WebGPU** 3D. **Borrow:** 3D renderer against an unchanged brain; MCP tool integration.

## Family 3 — Frameworks for the "AI company" brain (no built-in world)

Multi-agent collaboration logic you can wire a world onto. Use for the *brain* when
the user cares about real task output, then visualize with a Family-1/2 renderer.

- **MetaGPT** — simulates a software company ("Code = SOP(Team)"): PM, architect,
  engineer roles run an SDLC from one requirement.
- **ChatDev** — virtual software company; role dialogue across define→design→code→test.
- **AgentVerse** — task-solving *and* simulation frameworks for multi-expert agents.
  **Borrow:** role/SOP structures and message-passing patterns to feed your world state.

## Family 4 — HUD / command-center dashboards (dense live metrics)

Not pixel, not a game world — a futuristic **operations center**: per-agent panels
with live numbers, status badges, and connection graph. Best when agents are
*specialists with metrics* (trading desks, ops, monitoring) and the user needs to
read real values at a glance, not watch avatars walk.

- **CLAW3D** — https://www.claw3d.ai/ — 3D isometric office for agents (standups,
  task boards). **Borrow:** the immersive ops-center framing.
- Custom trading/ops dashboards (the user's AI-Trading-Office pattern): a central
  "control center" with a node per agent (Master, Market, Strategy, Entry, Exit,
  Risk, Execution, Liquidity), each a card showing status (WAITING/WORKING/BLOCKED)
  and that agent's live fields (confidence, SL/TP, risk %, ROI). Rendered as HTML/CSS
  + Canvas/SVG glow, often wrapped in **Electron** as a desktop app. **Borrow:** the
  panel-per-agent layout and the central hub + connection lines; still bound by the
  same honesty rule — every number comes from a real backend message.

---

## Choosing a base

- Want to **watch real agents** → fork from Family 1 (pixel) or build Family 4 (HUD).
- Want **autonomous characters** → fork AI Town (Convex) or an AgentOffice-style
  Phaser+Colyseus app.
- Want **real multi-agent work** *and* a view → Family 3 brain + Family 1/2/4 view.
- Whatever you fork, keep the brain/state/view split from `architecture.md` so you
  can swap the renderer (pixel ↔ HUD ↔ 3D) without rewriting the logic.
