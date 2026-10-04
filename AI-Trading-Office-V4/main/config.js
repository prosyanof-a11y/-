'use strict';
// Config lives in the MAIN process (per the agent-office skill, references/desktop.md):
// it can read/write userData, keep keys out of the DOM, and hold one authoritative socket.
//
// THE FALLBACK RULE (this is exactly what prevents the "everything OFFLINE" bug):
// a fresh install with no settings file must still be live out of the box. Empty
// settings resolve to the baked-in fallback, NEVER to a frozen "not_configured" screen.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Baked-in defaults. Point backendUrl at your "core" (the Railway WS endpoint).
// IMPORTANT: only ever embed a READ-ONLY key here. Anything that can place orders
// or mutate state must NOT ship inside a distributed binary.
const FALLBACK = {
  // The trading "core" (ядро). Replace with your real read-only office socket.
  backendUrl: 'wss://ai-trading-team-ctrader-production.up.railway.app/ws/office',
  officeKey: '',              // put a READ-ONLY office key here, or leave empty to run DEMO
  startInDemo: true,          // start alive in DEMO so the office never looks dead
  reconnectMs: 3000,
  handshakeTimeoutMs: 12000
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'office-settings.json');
}

function loadConfig() {
  try {
    const user = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return { ...FALLBACK, ...user };       // user file overrides fallback
  } catch {
    return { ...FALLBACK };                // no file -> fallback, still works
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    // Non-fatal: the app keeps running on the in-memory config.
    console.error('[config] could not persist settings:', e.message);
  }
  return next;
}

module.exports = { FALLBACK, loadConfig, saveConfig, settingsFile };
