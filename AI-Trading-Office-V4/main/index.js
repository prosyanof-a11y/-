'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');
const { CoreSocket } = require('./socket');

let win = null;
let core = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#070c18',
    title: 'AI Trading Office',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // The core socket forwards backend state + its own status to the window.
  core = new CoreSocket(
    (status, extra) => send('core:status', { status, ...(extra || {}) }),
    (message) => send('core:message', message)
  );
  core.connect(loadConfig());
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- IPC handlers ----
ipcMain.handle('config:get', () => {
  const c = loadConfig();
  // Never leak the key into the renderer/DOM; expose only whether one is set.
  const { officeKey, ...safe } = c;
  return { ...safe, hasKey: Boolean(officeKey) };
});

ipcMain.handle('config:save', (_e, patch) => {
  const next = saveConfig(patch || {});
  if (core) core.connect(next);            // reconnect with new settings
  const { officeKey, ...safe } = next;
  return { ...safe, hasKey: Boolean(officeKey) };
});

ipcMain.handle('core:reconnect', () => {
  if (core) core.connect(loadConfig());
  return true;
});

ipcMain.handle('app:version', () => app.getVersion());

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (core) core.disconnect();
  if (process.platform !== 'darwin') app.quit();
});
