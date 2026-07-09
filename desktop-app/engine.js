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

// Local-first, and now local-only-by-default-model: verified that the whole
// pipeline works on a single local model, so there is exactly one Ollama
// model in this codebase — no per-role choice, no tick boxes, no fallback
// chain. 'ollama' | 'claude-cli'.
const LLM_PROVIDER_DEFAULT = 'ollama';
const OLLAMA_URL_DEFAULT = 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL = 'llama3.1:8b'; // Llama 3.1 8B Instruct — the only local model this app uses.

async function callLLM(systemPrompt, userPrompt) {
  const provider = ScriptProperties.getProperty('LLM_PROVIDER') || LLM_PROVIDER_DEFAULT;
  if (provider === 'claude-cli') {
    return callClaudeCli(systemPrompt, userPrompt);
  }
  return callOllama(systemPrompt, userPrompt);
}

async function callOllama(systemPrompt, userPrompt) {
  const url = ScriptProperties.getProperty('OLLAMA_URL') || OLLAMA_URL_DEFAULT;
  const payload = {
    model: OLLAMA_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (response.status !== 200) {
    throw new Error('Ollama error ' + response.status + ' for model "' + OLLAMA_MODEL + '": ' + text);
  }

  const body = JSON.parse(text);
  if (!body.choices || !body.choices[0] || !body.choices[0].message) {
    throw new Error('Unexpected Ollama response shape for model "' + OLLAMA_MODEL + '": ' + text.slice(0, 300));
  }
  return body.choices[0].message.content;
}

// Always local, always OLLAMA_MODEL. getPlan calls this directly rather than
// going through callLLM's provider switch: the "what does the user actually
// need" step should stay fast, free, and available even when LLM_PROVIDER is
// pointed at claude-cli for the backend that does the actual drafting.
async function callPromptAuditor(systemPrompt, userPrompt) {
  try {
    return await callOllama(systemPrompt, userPrompt);
  } catch (err) {
    throw new Error('Prompt auditor (local ' + OLLAMA_MODEL + ') is unreachable. This step always ' +
      'runs locally regardless of your provider setting — install/start Ollama and pull ' +
      OLLAMA_MODEL + ', then try again. (' + err.message + ')');
  }
}

const CLAUDE_CLI_BIN_DEFAULT = 'claude';
const CLAUDE_CLI_MODEL_DEFAULT = 'claude-sonnet-5';
const CLAUDE_CLI_TIMEOUT_MS = 120000;

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
function callClaudeCli(systemPrompt, userPrompt) {
  const bin = ScriptProperties.getProperty('CLAUDE_CLI_PATH') || CLAUDE_CLI_BIN_DEFAULT;
  const model = ScriptProperties.getProperty('CLAUDE_CLI_MODEL') || CLAUDE_CLI_MODEL_DEFAULT;
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

  const raw = await callLLM(systemPrompt, userPrompt);
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
// 3-strikes convention: after this many rounds the prompt auditor is told to
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
 * Stage 1 of the HITL flow — the prompt auditor (see callPromptAuditor;
 * always local Llama 3.1 8B Instruct, never the configured backend
 * provider). Before drafting a plan, it first judges whether the
 * request has enough detail to plan confidently for the chosen output type —
 * if not, it asks a short list of clarifying questions instead of guessing.
 * The renderer collects the user's answers and calls this again with the
 * growing `clarifications` history; that repeats until it returns a plan, or
 * MAX_CLARIFICATION_ROUNDS is hit and it's told to stop asking and draft its
 * best plan with reasonable assumptions. Only once this resolves to "ready"
 * does the request go on to handshake with the backend pipeline (buildContent
 * in docgen.js) that actually drafts the output — that stage still runs on
 * whatever provider/model the user has configured.
 * Resolves to { status: 'ready', plan } or
 * { status: 'needs_clarification', questions: [...] }.
 */
async function getPlan(userRequest, attachments, outputType, clarifications) {
  const describe = OUTPUT_TYPE_COPY[outputType] || OUTPUT_TYPE_COPY.document;
  const forceReady = (clarifications || []).length >= MAX_CLARIFICATION_ROUNDS;
  const systemPrompt = 'You are the prompt auditor for an office document generator: your job ' +
    'is to pin down exactly what the user needs before it is handed off to the system that ' +
    'drafts the output. Given a user\'s request and any reference material, first judge ' +
    'whether you have enough detail to confidently plan ' + describe + '. ' +
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
  const raw = await callPromptAuditor(systemPrompt, userPrompt);
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
  callLLM,
  callOllama,
  callClaudeCli,
  callPromptAuditor,
  buildAttachmentContext,
  classifyAttachments,
  parseAttachmentRoles,
  getPlan,
  OLLAMA_MODEL
};
