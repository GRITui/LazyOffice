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

ipcMain.handle('lazyoffice:getPlan', (event, userRequest, attachments, outputType) => engine.getPlan(userRequest, attachments, outputType));
ipcMain.handle('lazyoffice:classifyAttachments', (event, attachments) => engine.classifyAttachments(attachments));
ipcMain.handle('lazyoffice:generateOutput', (event, userRequest, attachments, outputType) => docgen.generateOutput(userRequest, attachments, outputType));
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
