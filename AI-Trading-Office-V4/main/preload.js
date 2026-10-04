'use strict';
// Safe bridge between main and renderer. contextIsolation is on; the renderer gets
// a small, explicit `window.office` API and nothing else from Node.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  // Push channels (main -> renderer)
  onStatus: (cb) => ipcRenderer.on('core:status', (_e, payload) => cb(payload)),
  onMessage: (cb) => ipcRenderer.on('core:message', (_e, payload) => cb(payload)),

  // Request/response (renderer -> main)
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  reconnect: () => ipcRenderer.invoke('core:reconnect'),
  appVersion: () => ipcRenderer.invoke('app:version')
});
