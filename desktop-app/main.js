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

ipcMain.handle('lazyoffice:getPlan', (event, userRequest, attachments) => engine.getPlan(userRequest, attachments));
ipcMain.handle('lazyoffice:classifyAttachments', (event, attachments) => engine.classifyAttachments(attachments));
ipcMain.handle('lazyoffice:generateDoc', (event, userRequest, attachments) => docgen.generateDoc(userRequest, attachments));
ipcMain.handle('lazyoffice:openInFinder', (event, filePath) => shell.showItemInFolder(filePath));

const SETTINGS_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OLLAMA_URL',
  'OLLAMA_ORCHESTRATOR_MODEL',
  'OLLAMA_PLANNER_MODEL',
  'OLLAMA_CODE_ENGINE_MODEL'
];

ipcMain.handle('lazyoffice:getSettings', () => {
  const settings = {};
  SETTINGS_KEYS.forEach((key) => { settings[key] = ScriptProperties.getProperty(key) || ''; });
  return settings;
});

ipcMain.handle('lazyoffice:setSettings', (event, settings) => {
  SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      ScriptProperties.setProperty(key, settings[key]);
    }
  });
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
