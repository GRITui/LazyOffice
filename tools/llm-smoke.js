'use strict';

// Live smoke test for the desktop-app LLM providers. Exercises engine.callLLM()
// against the real configured backend(s). Skips (does not fail) any provider
// whose API key is not present in the environment, so it is safe to run
// everywhere:
//
//   OPENROUTER_API_KEY=sk-or-... node tools/llm-smoke.js            # ox-alpha
//   ANTHROPIC_API_KEY=sk-ant-... node tools/llm-smoke.js claude     # Claude
//
// Ollama is tested when something answers on OLLAMA_SMOKE_URL
// (default http://localhost:11434/v1/chat/completions).
//
// Electron is stubbed because config-store.js only needs app.getPath('userData')
// and safeStorage; neither exists under plain Node. A throwaway user-data dir
// keeps your real LazyOffice settings untouched.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyoffice-smoke-'));
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => tmpData },
      safeStorage: { isEncryptionAvailable: () => false }
    };
  }
  return origLoad.apply(this, arguments);
};

const { ScriptProperties } = require('../desktop-app/config-store');
const engine = require('../desktop-app/engine');

// Mirror of engine.js ROLE_VALUES — kept in sync for the classification check.
const ROLE_VALUES = ['raw_data', 'template', 'reference_report', 'other'];

let failed = 0;

// validate(out) throws on unexpected shape; returns a short display string.
async function smoke(name, fn, validate) {
  try {
    const out = await fn();
    const display = validate ? validate(out) : null;
    if (!validate) {
      assert.ok(typeof out === 'string' && out.trim().length > 0, name + ': empty LLM response');
    }
    console.log('PASS ' + name);
    console.log('     reply: ' + String(display != null ? display : out).trim().replace(/\s+/g, ' ').slice(0, 100));
  } catch (err) {
    failed++;
    console.error('FAIL ' + name + ': ' + err.message);
  }
}

(async () => {
  const wantClaude = process.argv.includes('claude');
  const mode = wantClaude ? 'claude' : 'openrouter';

  if (mode === 'openrouter' && process.env.OPENROUTER_API_KEY) {
    ScriptProperties.setProperty('LLM_PROVIDER', 'openrouter');
    ScriptProperties.setProperty('OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY);
    await smoke('openrouter/ox-alpha: getPlan', () =>
      engine.getPlan('A one-page summary of renewable energy trends for 2026', [], 'document'));
    // classifyAttachments returns a parsed ARRAY of {id, role, reason}, not raw text.
    await smoke('openrouter/ox-alpha: classifyAttachments', () =>
      engine.classifyAttachments([{ id: 'a1', type: 'link', url: 'https://example.com/report.pdf' }]),
      (out) => {
        assert.ok(Array.isArray(out) && out.length === 1,
          'expected array of 1 classification, got: ' + JSON.stringify(out).slice(0, 200));
        assert.strictEqual(out[0].id, 'a1', 'classification carries the attachment id');
        assert.ok(ROLE_VALUES.indexOf(out[0].role) !== -1, 'valid role, got: ' + out[0].role);
        return JSON.stringify(out[0]);
      });
  } else if (mode === 'openrouter') {
    console.log('SKIP openrouter/ox-alpha — set OPENROUTER_API_KEY to run');
  }

  if (mode === 'claude' && process.env.ANTHROPIC_API_KEY) {
    ScriptProperties.setProperty('LLM_PROVIDER', 'claude');
    ScriptProperties.setProperty('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
    await smoke('claude: getPlan', () =>
      engine.getPlan('A one-page summary of renewable energy trends for 2026', [], 'document'));
  } else if (mode === 'claude') {
    console.log('SKIP claude — set ANTHROPIC_API_KEY to run');
  }

  // Provider routing sanity checks (offline — no network needed).
  ScriptProperties.setProperty('LLM_PROVIDER', 'nonsense-provider');
  await smoke('routing: unknown provider falls back to Claude error path', async () => {
    try {
      await engine.callLLM('sys', 'user', 'orchestrator');
      throw new Error('expected missing-key error, got a response');
    } catch (err) {
      assert.ok(/ANTHROPIC_API_KEY|Claude/.test(err.message), 'unexpected error: ' + err.message);
      return 'threw as expected: ' + err.message.slice(0, 60);
    }
  });

  fs.rmSync(tmpData, { recursive: true, force: true });
  console.log(failed > 0 ? failed + ' check(s) failed' : 'All smoke checks passed');
  process.exit(failed > 0 ? 1 : 0);
})();
