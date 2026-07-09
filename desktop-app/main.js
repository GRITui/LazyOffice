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

ipcMain.handle('lazyoffice:getPlan', (event, userRequest, attachments, outputType) => engine.getPlan(userRequest, attachments, outputType));
ipcMain.handle('lazyoffice:classifyAttachments', (event, attachments) => engine.classifyAttachments(attachments));
ipcMain.handle('lazyoffice:generateOutput', (event, userRequest, attachments, outputType) => docgen.generateOutput(userRequest, attachments, outputType));
ipcMain.handle('lazyoffice:openInFinder', (event, filePath) => shell.showItemInFolder(filePath));

const SETTINGS_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OLLAMA_URL',
  'OLLAMA_ORCHESTRATOR_MODEL',
  'OLLAMA_PLANNER_MODEL',
  'OLLAMA_SYNTAX_MODEL',
  'OLLAMA_CODE_ENGINE_MODEL',
  'OLLAMA_GENERALIST_MODEL'
];

const SECRET_KEYS = ['ANTHROPIC_API_KEY'];

ipcMain.handle('lazyoffice:getSettings', () => {
  const props = ScriptProperties.getProperties(); // single read; sensitive values decrypted
  const settings = {};
  SETTINGS_KEYS.forEach((key) => {
    if (SECRET_KEYS.indexOf(key) !== -1) {
      // Never send secrets to the renderer. Report only whether a usable key is
      // stored (SET) and whether one is stored but can't be read on this machine
      // (UNREADABLE — decrypt failed), so the UI can prompt appropriately.
      const val = props[key];
      settings[key] = '';
      settings[key + '_SET'] = typeof val === 'string' && val.length > 0;
      settings[key + '_UNREADABLE'] = val === null; // present in config but decrypt failed
    } else {
      settings[key] = props[key] || '';
    }
  });
  return settings;
});

ipcMain.handle('lazyoffice:setSettings', (event, settings) => {
  // Only the keys the renderer actually sent are written. For secrets the
  // renderer omits the key entirely when the field is left blank, so a blank
  // Save never overwrites (and never destroys) a stored key.
  const toWrite = {};
  SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      toWrite[key] = settings[key];
    }
  });
  ScriptProperties.setProperties(toWrite);
});

app.whenReady().then(() => {
  // One-time upgrade: encrypt any secret that was stored in plaintext before
  // at-rest encryption existed. No-op once everything is already encrypted.
  try {
    const migrated = ScriptProperties.migrateSecrets();
    if (migrated) console.log('[config-store] migrated ' + migrated + ' secret(s) to encrypted-at-rest.');
  } catch (err) {
    console.warn('[config-store] secret migration skipped:', err && err.message);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
