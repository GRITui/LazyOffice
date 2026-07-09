// First-run local-LLM setup. LazyOffice is local-first (see engine.js):
// every local call — the pipeline and the always-local prompt auditor alike
// — runs on one verified model, engine.js's OLLAMA_MODEL. This module
// detects whether it's already installed and pulls it if not; it never
// blindly re-downloads, and it never installs the Ollama runtime itself
// (that's a system component; if it's absent the UI guides the user to it).
//
// Uses Ollama's native HTTP API (default 127.0.0.1:11434):
//   GET  /api/tags  -> installed models
//   POST /api/pull  -> streamed NDJSON download progress
const http = require('http');
const { URL } = require('url');

// Same tag as engine.js's OLLAMA_MODEL — the only model this app needs
// locally. Kept as an array of {tag, role} (rather than a bare string) so
// the rest of this module's shape didn't need to change from when it
// tracked several required models.
const REQUIRED_MODELS = [
  { tag: 'llama3.1:8b', role: 'Local model' }
];

const DEFAULT_HOST = 'http://127.0.0.1:11434';

// Derive the Ollama base host from the OLLAMA_URL setting (which points at the
// OpenAI-compatible chat path, e.g. http://host:11434/v1/chat/completions).
function hostFromOllamaUrl(url) {
  if (!url) return DEFAULT_HOST;
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.host;
  } catch (err) {
    return DEFAULT_HOST;
  }
}

function normalizeTag(tag) {
  return tag.indexOf(':') !== -1 ? tag : tag + ':latest';
}

function getJson(host, path) {
  return new Promise((resolve, reject) => {
    const u = new URL(host + path);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', timeout: 4000 },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function getInstalledModels(host) {
  const body = await getJson(host, '/api/tags');
  return (body.models || []).map((m) => m.name).filter(Boolean);
}

async function isOllamaUp(host) {
  try { await getInstalledModels(host); return true; } catch (err) { return false; }
}

function computeMissing(installed) {
  const have = {};
  installed.forEach((name) => { have[normalizeTag(name)] = true; });
  return REQUIRED_MODELS.filter((m) => !have[normalizeTag(m.tag)]);
}

// A snapshot the UI uses to decide what to show on first run.
async function status(host) {
  const up = await isOllamaUp(host);
  if (!up) {
    return { ollamaUp: false, installed: [], missing: REQUIRED_MODELS.slice(), hasAnyLlm: false, required: REQUIRED_MODELS.length };
  }
  const installed = await getInstalledModels(host);
  return {
    ollamaUp: true,
    installed: installed,
    missing: computeMissing(installed),
    hasAnyLlm: installed.length > 0,
    required: REQUIRED_MODELS.length
  };
}

// Stream a single `ollama pull`. onProgress receives ({tag, status, completed,
// total, percent}) for each NDJSON line. Resolves on completion, rejects on
// an error line or transport failure.
function pullModel(host, tag, onProgress) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name: tag, stream: true });
    const u = new URL(host + '/api/pull');
    const req = http.request(
      {
        hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      },
      (res) => {
        let buf = '';
        let failed = null;
        res.on('data', (chunk) => {
          buf += chunk.toString();
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let obj;
            try { obj = JSON.parse(line); } catch (e) { continue; }
            if (obj.error) { failed = new Error(obj.error); continue; }
            if (onProgress) {
              const total = obj.total || 0;
              const completed = obj.completed || 0;
              onProgress({
                tag: tag,
                status: obj.status || '',
                completed: completed,
                total: total,
                percent: total ? Math.round((completed / total) * 100) : null
              });
            }
          }
        });
        res.on('end', () => (failed ? reject(failed) : resolve()));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Pull every missing required model in order. onProgress streams per-line
// progress; onModelDone fires after each model completes. Returns a fresh
// status() when finished.
async function ensureModels(host, onProgress, onModelDone) {
  const st = await status(host);
  if (!st.ollamaUp) throw new Error('Ollama is not reachable at ' + host + '. Install/start Ollama first.');
  for (let i = 0; i < st.missing.length; i++) {
    const m = st.missing[i];
    await pullModel(host, m.tag, onProgress);
    if (onModelDone) onModelDone(m);
  }
  return status(host);
}

module.exports = {
  REQUIRED_MODELS,
  DEFAULT_HOST,
  hostFromOllamaUrl,
  normalizeTag,
  getInstalledModels,
  isOllamaUp,
  computeMissing,
  status,
  pullModel,
  ensureModels
};
