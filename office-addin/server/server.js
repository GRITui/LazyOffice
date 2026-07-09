// Office Add-ins require the task pane to be served over HTTPS, even for
// local development — Office won't load an http:// source. This uses
// office-addin-dev-certs, the standard tooling every Yeoman-generated
// Office Add-in project uses, which installs a locally-trusted dev
// certificate the first time it runs.

const express = require('express');
const path = require('path');
const https = require('https');
const devCerts = require('office-addin-dev-certs');
const engine = require('./engine');
const content = require('./content');
const { ScriptProperties } = require('./config-store');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..')));

app.post('/api/getPlan', async (req, res) => {
  try {
    const { request, attachments, outputType } = req.body;
    const plan = await engine.getPlan(request, attachments, outputType);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/classifyAttachments', async (req, res) => {
  try {
    const { attachments } = req.body;
    const roles = await engine.classifyAttachments(attachments);
    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generateContent', async (req, res) => {
  try {
    const { request, attachments, outputType } = req.body;
    const result = await content.generateContent(request, attachments, outputType);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SETTINGS_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OLLAMA_URL',
  'OLLAMA_ORCHESTRATOR_MODEL',
  'OLLAMA_PLANNER_MODEL',
  'OLLAMA_CODE_ENGINE_MODEL'
];

app.get('/api/settings', (req, res) => {
  const settings = {};
  SETTINGS_KEYS.forEach((key) => { settings[key] = ScriptProperties.getProperty(key) || ''; });
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      ScriptProperties.setProperty(key, req.body[key]);
    }
  });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

(async () => {
  const certOptions = await devCerts.getHttpsServerOptions();
  https.createServer(certOptions, app).listen(PORT, () => {
    console.log('LazyOffice Office Add-in server running at https://localhost:' + PORT);
    console.log('Manifest: https://localhost:' + PORT + '/manifest.xml');
    console.log('Sideload with: npx office-addin-debugging start manifest.xml');
  });
})();
