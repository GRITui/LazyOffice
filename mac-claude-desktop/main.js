const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const engine = require('./engine');
const docgen = require('./docgen');
const { ScriptProperties } = require('./config-store');

function createWindow() {
  const win = new BrowserWindow({
    width: 820,
    height: 920,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('lazyoffice:getPlan', (event, userRequest, attachments, outputType, clarifications) => engine.getPlan(userRequest, attachments, outputType, clarifications));
ipcMain.handle('lazyoffice:classifyAttachments', (event, attachments) => engine.classifyAttachments(attachments));
ipcMain.handle('lazyoffice:buildContent', (event, userRequest, attachments, outputType) => docgen.buildContent(userRequest, attachments, outputType));
ipcMain.handle('lazyoffice:createOutput', (event, outputType, parsed) => docgen.createOutput(outputType, parsed));
ipcMain.handle('lazyoffice:openInFinder', (event, filePath) => shell.showItemInFolder(filePath));

// Reports whether Claude Desktop's remote-debugging port is reachable —
// there is no model to download/pull for this track (unlike desktop-app's
// first-run Ollama setup), just a running app to attach to.
ipcMain.handle('lazyoffice:claudeDesktopStatus', () => engine.checkStatus());

// No secrets here — there's no API key in this track at all, only where to
// find Claude Desktop's remote-debugging port.
const SETTINGS_KEYS = [
  'CLAUDE_DESKTOP_CDP_HOST',
  'CLAUDE_DESKTOP_CDP_PORT'
];

ipcMain.handle('lazyoffice:getSettings', () => {
  const props = ScriptProperties.getProperties();
  const settings = {};
  SETTINGS_KEYS.forEach((key) => { settings[key] = props[key] || ''; });
  return settings;
});

ipcMain.handle('lazyoffice:setSettings', (event, settings) => {
  const toWrite = {};
  SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      toWrite[key] = settings[key];
    }
  });
  ScriptProperties.setProperties(toWrite);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
