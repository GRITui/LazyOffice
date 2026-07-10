// Desktop port of apps-script/Code.gs's LLM logic. Structure is kept close
// to the original on purpose (same function names/shapes) so the two stay
// easy to compare/sync — the differences are: async/await instead of GAS's
// synchronous style (native fetch instead of UrlFetchApp), a local JSON
// config store instead of PropertiesService, and Buffer instead of
// Utilities.base64Decode/newBlob. Output generation (document/spreadsheet/
// presentation) lives in docgen.js and writes local files instead of
// calling DocumentApp/SpreadsheetApp/SlidesApp — this desktop prototype has
// no Google Drive dependency at all.

const { ScriptProperties } = require('./config-store');
const { spawn } = require('child_process');
const os = require('os');

// All 5 First Goal doc roles, restored after being collapsed to a single
// model — each is now independently wireable to any backend (Ollama with
// any tag, the Claude CLI, or a generic OpenAI-compatible endpoint), not
// just a different Ollama model tag within one fixed backend. These are the
// DEFAULTS only — see resolveRoleConfig, which layers the user's own
// Settings (ROLE_BACKEND_CONFIG) on top, role by role.
const ROLE_DEFAULTS = {
  orchestrator: { roleLabel: 'Orchestrator', type: 'ollama', model: 'qwen3.5:9b' },
  planner: { roleLabel: 'Planner', type: 'ollama', model: 'deepseek-r1:7b' },
  syntax_enforcer: { roleLabel: 'Syntax Enforcer', type: 'ollama', model: 'phi4-mini:3.8b' },
  code_engine: { roleLabel: 'Code Engine', type: 'ollama', model: 'granite4.1:8b' },
  generalist: { roleLabel: 'Generalist', type: 'ollama', model: 'llama3.1:8b' }
};

const BACKEND_TYPES = [
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'claude-cli', label: 'Claude CLI' },
  { value: 'openai-compatible', label: 'Custom (OpenAI-compatible endpoint)' }
];

const OLLAMA_URL_DEFAULT = 'http://localhost:11434/v1/chat/completions';
const CLAUDE_CLI_BIN_DEFAULT = 'claude';
const CLAUDE_CLI_MODEL_DEFAULT = 'claude-sonnet-5';
const CLAUDE_CLI_TIMEOUT_MS = 120000;

// Layers Settings' per-role overrides on top of that role's defaults. A role
// with no stored config at all (or a stored config missing a `type`) falls
// back entirely to ROLE_DEFAULTS — so a fresh install behaves exactly like
// the First Goal doc's original mapping without the user configuring
// anything. A role using the 'ollama' backend without its own `url`
// override picks up the shared OLLAMA_URL setting (one server address for
// most roles, rather than re-entering the same URL five times), falling
// back to OLLAMA_URL_DEFAULT if that isn't set either.
function resolveRoleConfig(role) {
  const stored = ScriptProperties.getProperty('ROLE_BACKEND_CONFIG') || {};
  const fallback = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.generalist;
  const roleStored = stored[role];
  const merged = (!roleStored || !roleStored.type) ? Object.assign({}, fallback) : Object.assign({}, fallback, roleStored);
  if (merged.type === 'ollama' && !merged.url) {
    merged.url = ScriptProperties.getProperty('OLLAMA_URL') || OLLAMA_URL_DEFAULT;
  }
  return merged;
}

// Every role currently resolved to the 'ollama' backend, deduped by tag —
// the list setup-llm.js needs to know what to check/pull on first run. Roles
// pointed at claude-cli or a custom endpoint need nothing downloaded.
function computeOllamaRequiredModels() {
  const seen = {};
  const result = [];
  Object.keys(ROLE_DEFAULTS).forEach((role) => {
    const config = resolveRoleConfig(role);
    if (config.type !== 'ollama' || !config.model || seen[config.model]) return;
    seen[config.model] = true;
    result.push({ tag: config.model, role: ROLE_DEFAULTS[role].roleLabel });
  });
  return result;
}

// Both Ollama and a generic OpenAI-compatible endpoint speak the same
// request/response shape (POST {model, messages} -> {choices[0].message}),
// so one function serves both backend types — they differ only in default
// URL and whether an API key header is sent.
async function callOpenAiStyle(url, model, apiKey, systemPrompt, userPrompt) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const payload = {
    model: model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error('Backend error ' + response.status + ' for model "' + model + '" at ' + url + ': ' + text);
  }

  const body = JSON.parse(text);
  if (!body.choices || !body.choices[0] || !body.choices[0].message) {
    throw new Error('Unexpected response shape from ' + url + ': ' + text.slice(0, 300));
  }
  return body.choices[0].message.content;
}

/**
 * Shells out to a locally-installed Claude Code CLI as a one-shot text
 * completion backend — rides on the user's own `claude` login instead of a
 * separately-managed Anthropic API key. Framework-stage: written from the
 * CLI's documented headless-mode flags (code.claude.com/docs/en/headless.md),
 * not yet exercised against a real installed CLI — this sandbox doesn't have
 * one wired up the way the Owner's machine will, so treat this as unverified
 * until run for real (see README).
 *
 * Locked down deliberately: --allowedTools "" so the call can never end up
 * blocked on a permission prompt (there is no TTY to answer one) or take a
 * side-effecting action (Bash, file edits) as an accidental consequence of
 * what is supposed to be a pure text-in/text-out call; --bare skips
 * hook/MCP/skill discovery; cwd is a scratch temp dir so it never picks up
 * this repo's own CLAUDE.md/hooks. --output-format json is used so the
 * response can be parsed from the "result" field rather than scraped from
 * mixed stdout.
 */
function callClaudeCliProcess(config, systemPrompt, userPrompt) {
  const bin = config.path || CLAUDE_CLI_BIN_DEFAULT;
  const model = config.model || CLAUDE_CLI_MODEL_DEFAULT;
  const args = [
    '--bare',
    '-p', userPrompt,
    '--append-system-prompt', systemPrompt,
    '--output-format', 'json',
    '--allowedTools', '',
    '--model', model
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(bin, args, { cwd: os.tmpdir() });
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Claude CLI timed out after ' + Math.round(CLAUDE_CLI_TIMEOUT_MS / 1000) + 's.'));
    }, CLAUDE_CLI_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Could not run the Claude CLI ("' + bin + '"). Is it installed and on PATH? ' +
        'Set a custom path in Settings if not. (' + err.message + ')'));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('Claude CLI exited with code ' + code + ': ' + (stderr || stdout).slice(0, 500)));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error('Unexpected Claude CLI output (not JSON): ' + stdout.slice(0, 300)));
        return;
      }
      if (typeof parsed.result !== 'string') {
        reject(new Error('Unexpected Claude CLI JSON shape (no "result" field): ' + stdout.slice(0, 300)));
        return;
      }
      resolve(parsed.result);
    });
  });
}

function callBackend(config, systemPrompt, userPrompt) {
  if (config.type === 'claude-cli') {
    return callClaudeCliProcess(config, systemPrompt, userPrompt);
  }
  if (config.type === 'openai-compatible') {
    if (!config.url) throw new Error('No endpoint URL configured for this role\'s custom backend.');
    return callOpenAiStyle(config.url, config.model || 'default', config.apiKey, systemPrompt, userPrompt);
  }
  // default: ollama
  return callOpenAiStyle(config.url || OLLAMA_URL_DEFAULT, config.model, null, systemPrompt, userPrompt);
}

/**
 * The single LLM entry point every call site uses, always naming which of
 * the 5 First Goal doc roles it's calling for. Each role resolves to its own
 * backend independently (see resolveRoleConfig) — unlike the single-model
 * era, there is no longer one global provider switch, and no special-cased
 * "always local" bypass for the Orchestrator: it's just another role with
 * its own configurable backend now.
 */
async function callRole(role, systemPrompt, userPrompt) {
  const config = resolveRoleConfig(role);
  try {
    return await callBackend(config, systemPrompt, userPrompt);
  } catch (err) {
    const label = (ROLE_DEFAULTS[role] || {}).roleLabel || role;
    throw new Error(label + ' (' + config.type + (config.model ? ': ' + config.model : '') + ') failed: ' + err.message);
  }
}

const MAX_INLINE_TEXT_CHARS = 4000;
const TEXT_MIME_PATTERN = /^text\/|json$|csv$/;
const TEXT_FILENAME_PATTERN = /\.(txt|md|csv|json)$/i;
const ROLE_VALUES = ['raw_data', 'template', 'reference_report', 'other'];
const ROLE_LABELS = {
  raw_data: 'raw data',
  template: 'output template',
  reference_report: 'reference report/presentation',
  other: 'other reference'
};

function decodeBase64Text(base64) {
  return Buffer.from(base64, 'base64').toString('utf8');
}

function buildAttachmentContext(attachments) {
  if (!attachments || !attachments.length) {
    return '';
  }
  const parts = [];
  attachments.forEach((item) => {
    if (!item) return;
    const roleTag = item.role ? ' [role: ' + (ROLE_LABELS[item.role] || item.role) + ']' : '';
    if (item.type === 'link' && item.url) {
      parts.push('Reference link' + roleTag + ': ' + item.url);
      return;
    }
    if (item.type === 'file' && item.name) {
      const isText = TEXT_MIME_PATTERN.test(item.mimeType || '') || TEXT_FILENAME_PATTERN.test(item.name);
      if (isText && item.base64) {
        try {
          const text = decodeBase64Text(item.base64);
          parts.push('Reference file "' + item.name + '"' + roleTag + ' contents:\n' + text.slice(0, MAX_INLINE_TEXT_CHARS));
          return;
        } catch (err) {
          // fall through to filename-only reference below
        }
      }
      parts.push('Reference file "' + item.name + '"' + roleTag + ' (' + (item.mimeType || 'unknown type') +
        ') — content not inlined; treat as contextual reference only.');
    }
  });
  return parts.length ? '\n\nReference material provided by the user:\n' + parts.join('\n\n') : '';
}

async function classifyAttachments(attachments) {
  if (!attachments || !attachments.length) {
    return [];
  }
  const systemPrompt = 'You classify reference files/links attached to a document-generation ' +
    'request. For each item, decide which single role it plays: "raw_data" (source ' +
    'numbers/facts to pull from), "template" (defines the structure, sections, or ' +
    'formatting the output should follow), "reference_report" (an example finished ' +
    'report/presentation similar to the desired final output), or "other" (none of the ' +
    'above). Respond ONLY with a JSON array of objects shaped ' +
    '{"id": string, "role": "raw_data"|"template"|"reference_report"|"other", ' +
    '"reason": string (max 12 words)}. No markdown, no commentary — just the JSON array.';

  const userPrompt = 'Classify these attachments:\n\n' + attachments.map((item) => {
    if (item.type === 'link') {
      return 'id: ' + item.id + '\nlink: ' + item.url;
    }
    let descriptor = 'id: ' + item.id + '\nfilename: ' + item.name + '\ntype: ' + (item.mimeType || 'unknown');
    const isText = TEXT_MIME_PATTERN.test(item.mimeType || '') || TEXT_FILENAME_PATTERN.test(item.name || '');
    if (isText && item.base64) {
      try {
        descriptor += '\nexcerpt: ' + decodeBase64Text(item.base64).slice(0, 500);
      } catch (err) {
        // no excerpt available; classify on filename/type alone
      }
    }
    return descriptor;
  }).join('\n\n');

  const raw = await callRole('planner', systemPrompt, userPrompt);
  return parseAttachmentRoles(raw, attachments);
}

function parseAttachmentRoles(raw, attachments) {
  const byId = {};
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          if (entry && entry.id) {
            byId[entry.id] = {
              id: entry.id,
              role: ROLE_VALUES.indexOf(entry.role) !== -1 ? entry.role : 'other',
              reason: typeof entry.reason === 'string' ? entry.reason : 'Could not classify automatically.'
            };
          }
        });
      }
    } catch (err) {
      // fall through to per-item fallback below
    }
  }
  return attachments.map((item) => byId[item.id] || { id: item.id, role: 'other', reason: 'Could not classify automatically.' });
}

const OUTPUT_TYPE_COPY = {
  document: 'a document: its title and the sections/content it will contain',
  spreadsheet: 'a spreadsheet: its title and the columns/rows of data it will contain',
  presentation: 'a presentation: its title and the slides/bullet points it will contain'
};

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

// Circuit breaker on the clarification loop, mirroring the Squad Setup doc's
// 3-strikes convention: after this many rounds the Orchestrator is told to
// stop asking and just draft its best plan, so a request it keeps finding
// "unclear" can never trap the user in an endless Q&A loop.
const MAX_CLARIFICATION_ROUNDS = 3;

function buildClarificationContext(clarifications) {
  if (!clarifications || !clarifications.length) return '';
  const lines = clarifications.map((c, i) =>
    'Q' + (i + 1) + ': ' + c.question + '\nA' + (i + 1) + ': ' + (c.answer || '(no answer given)'));
  return '\n\nClarification so far:\n' + lines.join('\n');
}

/**
 * Stage 1 of the HITL flow — the Orchestrator role, restored to being a
 * regular independently-configurable role like the other 4 (see
 * ROLE_DEFAULTS). Before drafting a plan, it first judges whether the
 * request has enough detail to plan confidently for the chosen output type —
 * if not, it asks a short list of clarifying questions instead of guessing.
 * The renderer collects the user's answers and calls this again with the
 * growing `clarifications` history; that repeats until it returns a plan, or
 * MAX_CLARIFICATION_ROUNDS is hit and it's told to stop asking and draft its
 * best plan with reasonable assumptions.
 * Resolves to { status: 'ready', plan } or
 * { status: 'needs_clarification', questions: [...] }.
 */
async function getPlan(userRequest, attachments, outputType, clarifications) {
  const describe = OUTPUT_TYPE_COPY[outputType] || OUTPUT_TYPE_COPY.document;
  const forceReady = (clarifications || []).length >= MAX_CLARIFICATION_ROUNDS;
  const systemPrompt = 'You are the Orchestrator for an office document generator: your job is ' +
    'to pin down exactly what the user needs before it is handed off to the roles that draft ' +
    'the output. Given a user\'s request and any reference material, first judge whether you ' +
    'have enough detail to confidently plan ' + describe + '. ' +
    (forceReady
      ? 'You have already asked enough clarifying questions for this request — draft your best ' +
        'plan now using reasonable assumptions for anything still unclear. Do not ask further ' +
        'questions.'
      : 'If key details are genuinely missing (e.g. subject, scope, audience, data source, or ' +
        'desired length) and you cannot make a reasonable assumption, ask 1-3 short, specific ' +
        'clarifying questions instead of guessing. If the request is already clear enough, or a ' +
        'reasonable assumption would do, draft the plan instead — do not ask questions just to ' +
        'be thorough.') +
    ' If a reference item is tagged with a role, use "raw data" items as the source of facts/' +
    'numbers to cite, mirror the structure/sections of an "output template" item, and match the ' +
    'tone and format of a "reference report/presentation" item. Respond ONLY with a JSON object, ' +
    'either {"status": "ready", "plan": string} where plan is a short (2-4 sentence) plain-' +
    'language description of what will be created, or {"status": "needs_clarification", ' +
    '"questions": [string, ...]}. No markdown, no code fences, no commentary — just the JSON ' +
    'object.';
  const userPrompt = userRequest + buildAttachmentContext(attachments) + buildClarificationContext(clarifications);
  const raw = await callRole('orchestrator', systemPrompt, userPrompt);
  const parsed = extractJson(raw);

  if (parsed && parsed.status === 'needs_clarification' && Array.isArray(parsed.questions) &&
      parsed.questions.length && !forceReady) {
    return { status: 'needs_clarification', questions: parsed.questions.slice(0, 3).map(String) };
  }
  if (parsed && parsed.status === 'ready' && typeof parsed.plan === 'string' && parsed.plan.trim()) {
    return { status: 'ready', plan: parsed.plan };
  }
  // Soft-degrade per the crash-proofing convention: if the model didn't
  // return valid status/plan JSON, treat its raw text as the plan rather
  // than blocking the user on a parsing failure.
  return { status: 'ready', plan: raw };
}

module.exports = {
  callRole,
  buildAttachmentContext,
  classifyAttachments,
  parseAttachmentRoles,
  getPlan,
  ROLE_DEFAULTS,
  BACKEND_TYPES,
  resolveRoleConfig,
  computeOllamaRequiredModels
};
