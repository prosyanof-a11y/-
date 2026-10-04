# Agent Office — Desktop Delivery (Windows `.exe` and friends)

Goal: a double-click program. Launch it → a window opens → you immediately see what
your agents are doing right now, live. The office view is unchanged; you are only
wrapping it as a native app and giving it a reliable connection to the agent backend.

Use this for the observability case (watch REAL agents). The same wrapping works for
pixel, 3D, or HUD/command-center renderers — they are all just web content.

## Architecture inside the desktop app

```
Electron app
├── main process  (Node)   ── owns config + opens the WebSocket to the backend
│     ├─ loads settings: userData/settings.json  (user override)
│     │                   → else baked-in fallback (default URL + read-only key)
│     ├─ connects WS to the agent backend ("the core", e.g. wss://.../ws/office)
│     └─ forwards snapshots to the window via IPC (or lets the window connect directly)
└── renderer process (Chromium) ── the office view (HUD / pixel / 3D)
      └─ reads world-state snapshots, draws honest state (no invented status)
```

Why config lives in **main**, not renderer: the main process can read/write
`app.getPath('userData')`, hold secrets out of the DOM, and keep one authoritative
socket even if the window reloads.

## The settings + fallback rule (this prevents "everything OFFLINE")

A packaged app with empty settings must still work and must never show a dead screen.

```js
// main/config.js
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FALLBACK = {
  backendUrl: "wss://YOUR-BACKEND/ws/office",   // bake a sane default
  officeKey: "READ_ONLY_KEY",                   // read-only; never a write/admin key
};

function loadConfig() {
  const file = path.join(app.getPath("userData"), "settings.json");
  try {
    const user = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...FALLBACK, ...user };            // user file overrides fallback
  } catch {
    return { ...FALLBACK };                     // no file → use fallback, still works
  }
}
module.exports = { loadConfig };
```

- **Never** let "no settings file" resolve to `not_configured` → all-OFFLINE. Fall
  back to the baked default so a fresh install is live out of the box.
- Only embed a **read-only** key. Anything that can place orders / mutate state does
  not belong in a distributed binary.
- Expose an in-app settings screen that writes `userData/settings.json` for users who
  need a different backend.
- Show a small connection badge: **connected / connecting / not configured /
  rate-limited** — derived from the real socket, so the user always knows the truth.

## Connecting to the backend (the "core")

```js
// main/socket.js
const WebSocket = require("ws");
function connect(cfg, onSnapshot, onStatus) {
  const ws = new WebSocket(cfg.backendUrl, {
    headers: { "X-Office-Key": cfg.officeKey },
    handshakeTimeout: 12000,
  });
  ws.on("open",    () => onStatus("connected"));
  ws.on("message", (d) => onSnapshot(JSON.parse(d.toString())));  // world snapshot
  ws.on("error",   (e) => onStatus("error: " + e.message));
  ws.on("close",   () => { onStatus("reconnecting"); setTimeout(() => connect(cfg, onSnapshot, onStatus), 3000); });
  return ws;
}
module.exports = { connect };
```

Notes:
- Auto-reconnect with backoff — a desktop app is expected to survive network blips.
- If connecting fails only inside the app but a raw `node ws` test connects, suspect a
  **VPN / proxy / firewall** on the path, or a settings mismatch — isolate by testing
  the socket from `main` directly before blaming the UI.
- Keep the renderer a pure view of whatever snapshots arrive; honesty rule still holds.

## Packaging to a Windows `.exe`

Use **electron-builder**. Minimal `package.json`:

```jsonc
{
  "name": "agent-office",
  "version": "4.1.1",
  "main": "main/index.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win"          // → NSIS .exe installer in dist/
  },
  "build": {
    "appId": "com.yourco.agentoffice",
    "productName": "Agent Office",
    "win":  { "target": "nsis", "icon": "assets/icon.ico" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  },
  "devDependencies": { "electron": "^latest", "electron-builder": "^latest" },
  "dependencies": { "ws": "^latest" }
}
```

- `npm run dist` produces a Windows installer (`.exe`) under `dist/`. Add `mac`/`linux`
  targets for the other platforms; cross-building to Windows is most reliable on
  Windows (or CI).
- **Bump the version** on every rebuild (e.g. `4.1.1`) so users can tell the updated
  build apart from a cached old window — a classic "I rebuilt but see the old layout"
  trap is actually a stale install or a second window.
- For auto-updates later, electron-builder integrates with `electron-updater`.
- **Tauri** is a lighter alternative (Rust shell, system WebView, far smaller binary)
  if bundle size matters and you don't need Chromium specifics.

## Launch-and-verify checklist

- [ ] Fresh install with no settings file → window opens, connects via fallback, agents
      render live (not all-OFFLINE).
- [ ] Settings screen writes `userData/settings.json`; override takes effect on restart.
- [ ] Only a read-only key is embedded; no order/admin capability in the binary.
- [ ] Connection badge reflects the real socket state.
- [ ] Version bumped; confirm the running window is the new build (check the version in
      the title/about), and that no stale second window is open.
- [ ] Reconnect works after the network drops.
