const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const engine = require('./engine');
const docgen = require('./docgen');
const setupLlm = require('./setup-llm');
const { ScriptProperties } = require('./config-store');

function ollamaHost() {
  return setupLlm.hostFromOllamaUrl(ScriptProperties.getProperty('OLLAMA_URL') || '');
}

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

// --- First-run local-LLM setup ---
// Report whether Ollama is up, what's installed, which required models are
// missing, and whether the user has already completed/dismissed setup.
ipcMain.handle('lazyoffice:llmStatus', async () => {
  const st = await setupLlm.status(ollamaHost());
  st.provider = ScriptProperties.getProperty('LLM_PROVIDER') || 'ollama';
  st.setupDone = ScriptProperties.getProperty('LLM_SETUP_DONE') === 'true';
  st.host = ollamaHost();
  return st;
});

// Pull the missing required models, streaming progress to the renderer. Marks
// setup done once everything the pipeline needs is present.
ipcMain.handle('lazyoffice:llmSetup', async (event) => {
  const wc = event.sender;
  const host = ollamaHost();
  const final = await setupLlm.ensureModels(
    host,
    (p) => { if (!wc.isDestroyed()) wc.send('lazyoffice:llmProgress', p); },
    (m) => { if (!wc.isDestroyed()) wc.send('lazyoffice:llmModelDone', m); }
  );
  if (final.missing.length === 0) ScriptProperties.setProperty('LLM_SETUP_DONE', 'true');
  return final;
});

// Let the user dismiss/skip first-run setup so it doesn't reappear.
ipcMain.handle('lazyoffice:llmMarkDone', () => {
  ScriptProperties.setProperty('LLM_SETUP_DONE', 'true');
});

// No secrets among these — the Claude API key (and the safeStorage
// encryption that protected it at rest) is gone along with the Claude API
// option; CLAUDE_CLI_PATH/CLAUDE_CLI_MODEL configure the local `claude`
// binary, not a credential.
const SETTINGS_KEYS = [
  'LLM_PROVIDER',
  'OLLAMA_URL',
  'CLAUDE_CLI_PATH',
  'CLAUDE_CLI_MODEL'
];

ipcMain.handle('lazyoffice:getSettings', () => {
  const props = ScriptProperties.getProperties();
  const settings = {};
  SETTINGS_KEYS.forEach((key) => { settings[key] = props[key] || ''; });
  return settings;
});

ipcMain.handle('lazyoffice:setSettings', (event, settings) => {
  // Only the keys the renderer actually sent are written.
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
