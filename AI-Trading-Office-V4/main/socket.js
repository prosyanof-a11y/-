'use strict';
// The authoritative WebSocket to the trading "core" lives in the MAIN process so it
// can send the X-Office-Key header (browser/renderer WebSocket cannot set headers) and
// survive window reloads. It forwards every backend message + its own status to the
// renderer via a callback; the renderer stays a pure view (agent-office honesty rule:
// it only ever DRAWS state, it never invents it).

const WebSocket = require('ws');

class CoreSocket {
  constructor(onStatus, onMessage) {
    this.onStatus = onStatus;       // (status:string, extra?:object) => void
    this.onMessage = onMessage;     // (rawParsedJson:object) => void
    this.ws = null;
    this.cfg = null;
    this.closedByUs = false;
    this.reconnectTimer = null;
  }

  connect(cfg) {
    this.disconnect();              // tear down any previous socket first
    this.cfg = cfg;
    this.closedByUs = false;

    if (!cfg.backendUrl || !cfg.officeKey) {
      // No endpoint/key -> we stay in DEMO. This is "not_configured" but NOT dead:
      // the renderer keeps simulating a live office and shows a clear badge.
      this.onStatus('not_configured');
      return;
    }

    this.onStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(cfg.backendUrl, {
        headers: { 'X-Office-Key': cfg.officeKey },
        handshakeTimeout: cfg.handshakeTimeoutMs || 12000
      });
    } catch (e) {
      this.onStatus('error', { message: e.message });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => this.onStatus('connected'));
    ws.on('message', (data) => {
      let parsed;
      try { parsed = JSON.parse(data.toString()); }
      catch { parsed = { _raw: data.toString() }; }
      this.onMessage(parsed);
    });
    ws.on('error', (e) => this.onStatus('error', { message: e.message }));
    ws.on('close', (code) => {
      this.onStatus('reconnecting', { code });
      if (!this.closedByUs) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const ms = (this.cfg && this.cfg.reconnectMs) || 3000;
    this.reconnectTimer = setTimeout(() => {
      if (!this.closedByUs && this.cfg) this.connect(this.cfg);
    }, ms);
  }

  disconnect() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.terminate(); } catch {}
      this.ws = null;
    }
  }
}

module.exports = { CoreSocket };
