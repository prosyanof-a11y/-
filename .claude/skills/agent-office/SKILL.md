---
name: agent-office
description: >-
  Build a 2D or 3D "agent office" — a live visualization or simulation where AI
  agents appear as characters that walk to desks, think, talk, collaborate, take
  coffee breaks, and ship work inside a rendered office world. Use this skill
  WHENEVER the user wants to visualize AI agents in a spatial world, watch their
  coding agents (Claude Code, Codex, Gemini) as pixel/3D coworkers, build an
  "AI company / virtual office / agent town / generative-agent" simulation, show
  multi-agent collaboration as a game-like scene, or make a dashboard where
  agents are embodied characters rather than log lines — even if they only say
  "office for my agents", "agent village", "watch my agents work", "Smallville",
  "AI Town", or "pixel agents" without naming the architecture. Covers both
  modes: observability offices (visualize REAL agents from hook/event signals)
  and generative offices (AUTONOMOUS agents driven by an LLM perceive-think-act
  loop with memory). Reach for it before hand-rolling any agent-visualization UI.
---

# Agent Office

Build a spatial world — 2D pixel-art or 3D — where AI agents are **embodied
characters** in an office/town, not rows in a log. This skill distills the
architecture shared by the best open projects in the space (Stanford Generative
Agents, a16z AI Town, AgentOffice/aphae, claude-office, agent-virtual-office,
pixel-agents, CLAW3D, agents-home) into one reusable method.

## The one principle that governs everything

**Decouple the brain from the body, and connect them through a single
authoritative world state that is synced to the renderer in real time.**

```
  BRAIN (logic)                WORLD STATE                 BODY (view)
  what the agent is   ──────▶  single source of   ──────▶  avatar in the
  doing / deciding             truth (server/DB)           office, animated
      ▲                             │                           │
      │  events / tick              │  sync (WS / rooms /        │ user clicks,
      └─────────────────────────────┘  reactive DB / HTTP)  ◀────┘ camera, UI
```

Everything else — pixel vs. 3D, local LLM vs. API, Phaser vs. Three.js — is a
swappable implementation detail hanging off this spine. Projects that blur brain
and body (compute agent logic inside the render loop, or fake visual state that
no real event backs) become unmaintainable and dishonest. Keep them separate and
you can change the renderer without touching the agents, and vice versa.

Three invariants follow from this principle; hold them in every design:

1. **The server owns the truth; the client only draws it.** The renderer is a
   pure function of world state. Never let the view invent agent state it then
   "reports back" — that is how fake activity creeps in.
2. **State is a small, serializable snapshot**, pushed on change (events) or on a
   fixed tick (simulation) — never recomputed per animation frame. Per-frame work
   (movement interpolation, pathfinding, emotes) is presentation, derived locally
   from the latest snapshot.
3. **An agent's visible state must trace to a real signal** — a hook event, a
   tool call, an LLM decision. Honesty is the whole value of an agent office;
   invented status makes it a screensaver.

## Step 0 — Pick the mode and the dimension

Two decisions shape the whole build. Make them explicitly with the user before
writing code.

### Mode: observability vs. generative

| | **Observability office** | **Generative office** |
|---|---|---|
| Agents are… | REAL running agents (Claude Code, Codex, CI, your app) | AUTONOMOUS LLM characters you simulate |
| Driven by… | real events (hooks, webhooks, HTTP pings) | a perceive→think→act tick loop |
| Core value | honest, live view of actual work | emergent social/collaborative behavior |
| Needs memory? | usually no (state is ephemeral/real) | yes — memory stream + retrieval + reflection |
| Exemplars | agent-virtual-office, claude-office, pixel-agents | Generative Agents, AI Town, AgentOffice, aphae |
| Risk to avoid | faking state the renderer isn't told about | agents idling, looping, or amnesiac |

They are not exclusive — a **hybrid** office can simulate ambient life while
pinning some characters to real agents. If unsure which the user wants, ask:
*"Do you want to watch your actual agents working, or populate an office with
autonomous AI characters?"*

### Visual style: HUD dashboard vs. pixel-art vs. 3D

The style is **just the `view/` layer** — the brain/state spine is identical across
all three. Pick by what the agents *are* and what the user needs to read.

- **HUD / command-center dashboard** — a futuristic ops center: a panel (card) per
  agent showing its live status badge (WAITING / WORKING / BLOCKED) and that agent's
  real metrics, around a central hub with connection lines. **Best when agents are
  specialists with numbers** (trading desks, monitoring, ops) and the user must read
  real values at a glance. Renderers: HTML/CSS + Canvas/SVG for glow and the
  connection graph. This is the right default for a trading/ops "control center".
- **Pixel-art 2D** — cozy coworkers walking to desks, coffee, whiteboard. Charming
  and legible for *watching work happen*, weaker at dense live metrics. Renderers:
  PixiJS (sprites, most common), Phaser (tilemaps/physics), Canvas, or SVG+rAF
  (lightest).
- **3D** — immersive, demo-friendly, heavier. Renderers: Three.js (optionally WebGPU)
  in the browser, or Godot 4 natively.

You can offer more than one as a toggle over the same state (e.g. a dense HUD plus a
"cozy" pixel view). Build one style first, prove the honest-state loop, then add
another renderer against the same snapshot.

### Delivery form: web page vs. desktop program

- **Web** — serve the renderer; open in a browser. Simplest for dashboards and demos.
- **Desktop program (Windows `.exe` / macOS / Linux)** — wrap the *same* web renderer
  in **Electron** (or Tauri for a smaller binary). You get a double-click app: launch
  it and immediately see what the agents are doing. The Electron **main process**
  holds config (backend URL + keys) and opens the WebSocket to your agent backend; the
  **renderer process** is the HUD/pixel/3D view. Package to a Windows installer with
  **electron-builder** (`win` target → NSIS `.exe`). See `references/desktop.md`.
  - Bake a sane **fallback** backend URL + read-only key into the main process so the
    app works out of the box; let a local `userData/settings.json` override. Empty
    settings must show a clear "not configured" badge, **never** a frozen/all-OFFLINE
    screen.

## Step 1 — Read the reference that matches the build

Pull in only what you need, when you need it:

- **`references/architecture.md`** — the full component architecture for both
  modes, the state snapshot schema, the sync-mechanism decision guide, the
  Stanford memory model (retrieval = recency · importance · relevance → reflection
  → planning), the spatial model (tile grid, zones, A* pathfinding,
  approach-to-interact), and the state→visual mapping. **Read this first for any
  non-trivial build.**
- **`references/build-guide.md`** — opinionated minimal stacks and copy-ready
  skeletons: an observability office (hooks → FastAPI/Node → WebSocket →
  PixiJS/React) and a generative office (tick loop → Colyseus/Convex → renderer),
  plus the agent event/snapshot contracts. Read when you start implementing.
- **`references/landscape.md`** — the surveyed projects with links and exactly
  what to borrow from each (and what to avoid), including Family 4 (HUD /
  command-center dashboards). Read to choose a base to fork or to cite prior art.
- **`references/desktop.md`** — wrapping the office as a Windows/macOS/Linux desktop
  program with Electron: main vs. renderer split, config/fallback handling, the
  WebSocket-to-backend pattern, and `electron-builder` packaging to a `.exe`. Read
  when the deliverable is a double-click app, not a web page.

## Step 2 — Build the spine, then dress it

Work in this order so you always have something running:

1. **Define the world-state snapshot** (agents, positions, zones, per-agent
   status + current action). Keep it small and serializable. Schema in
   `architecture.md`.
2. **Stand up the state owner + sync.** Pick from the decision guide: HTTP-push +
   in-memory for the simplest observability office; WebSocket for live bidi;
   Colyseus (room-based) or Convex (reactive DB + vector search) for richer
   multiplayer/simulation.
3. **Wire the brain.**
   - *Observability:* register agent hooks / expose an HTTP `/status` and
     `/event` endpoint; map incoming signals → agent state. Classify honestly
     (working / blocked+reason / shipped / idle-after-timeout).
   - *Generative:* implement the perceive→think→act loop (~10–15s tick), LLM
     returns structured `{thought, action, target, toolCall}`, server applies it,
     memory is written and retrieved.
4. **Render the body.** Draw agents from state: place at positions, interpolate
   movement, run A* between zones, show status bubbles/emotes, animate per
   role+action. The renderer reads state and nothing else.
5. **Add life and legibility.** Zones (desks, coffee, whiteboard, lounge),
   speech/thought bubbles, an activity log, ambient events that *back off when
   real work is happening*, click-to-inspect an agent. Respect reduced-motion.
6. **Persist what should survive a restart** — generative memory and team
   composition to SQLite/Convex; observability state is typically ephemeral.

## Guardrails worth stating up front

- **Don't fake it.** In observability mode, an agent's status changes only when a
  real signal arrives. Prefer "idle/thinking after N seconds of silence" over
  inventing activity. This is the single most important quality bar.
- **Don't recompute logic in the render loop.** If the LLM or event handling runs
  per frame, the office will stutter and costs will explode. Logic on ticks/events;
  drawing per frame.
- **Make agents collaborate spatially**, not teleport-magically — they walk to a
  target, then interact. Proximity gating makes conversations legible and cheap.
- **Start local, stay swappable.** Default to an Ollama / OpenAI-compatible
  adapter behind an interface so the model is one config line, not a dependency
  baked through the code.
- **Degrade gracefully.** No model key → characters still move and the office
  still renders; show a clear "not configured" badge rather than a frozen scene.
