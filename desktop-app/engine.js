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

const CLAUDE_MODEL = 'claude-sonnet-5';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ox-alpha via OpenRouter: the new default provider. One cloud model serves all
// five pipeline roles — the role arg is kept so the pipeline shape (and any
// future per-role routing) survives, but every call routes to ox-alpha.
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL_DEFAULT = 'stealth/ox-alpha';

// Local-first fallback: runs entirely on a local Ollama server.
const LLM_PROVIDER_DEFAULT = 'openrouter'; // 'openrouter' | 'claude' | 'ollama'
const OLLAMA_URL_DEFAULT = 'http://localhost:11434/v1/chat/completions';
const OLLAMA_MODEL_DEFAULT = 'llama3.1:8b';

// The First Goal doc's 5-agent pipeline, same mapping as Code.gs.
const OLLAMA_ROLE_MODELS = {
  orchestrator: { property: 'OLLAMA_ORCHESTRATOR_MODEL', label: 'Qwen3.5-9B', ollamaTag: 'qwen3.5:9b' },
  planner: { property: 'OLLAMA_PLANNER_MODEL', label: 'DeepSeek-R1-Distill-Qwen-7B', ollamaTag: 'deepseek-r1:7b' },
  syntax_enforcer: { property: 'OLLAMA_SYNTAX_MODEL', label: 'Phi-4-mini (3.8B)', ollamaTag: 'phi4-mini:3.8b' },
  code_engine: { property: 'OLLAMA_CODE_ENGINE_MODEL', label: 'IBM Granite 4.1 8B', ollamaTag: 'granite4.1:8b' },
  generalist: { property: 'OLLAMA_GENERALIST_MODEL', label: 'Llama 3.1 8B Instruct', ollamaTag: 'llama3.1:8b' }
};

async function callLLM(systemPrompt, userPrompt, role) {
  const provider = ScriptProperties.getProperty('LLM_PROVIDER') || LLM_PROVIDER_DEFAULT;
  if (provider === 'openrouter') {
    return callOpenRouter(systemPrompt, userPrompt);
  }
  if (provider === 'ollama') {
    return callOllama(systemPrompt, userPrompt, role);
  }
  return callClaude(systemPrompt, userPrompt);
}

async function callOpenRouter(systemPrompt, userPrompt) {
  const apiKey = ScriptProperties.getProperty('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Open Settings and add your OpenRouter API key (for ox-alpha).');
  }

  // ox-alpha is a hybrid reasoning model: occasionally every token goes into
  // the internal reasoning channel and `content` comes back empty (or the
  // content arrives as an array of parts instead of a plain string). Retry
  // once on empty, and normalize both shapes before returning.
  let lastContent = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = {
      model: OPENROUTER_MODEL_DEFAULT,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        // Optional attribution headers recommended by OpenRouter.
        'HTTP-Referer': 'https://github.com/GRITui/LazyOffice',
        'X-Title': 'LazyOffice'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    if (response.status !== 200) {
      throw new Error('OpenRouter error ' + response.status + ': ' + text);
    }

    const body = JSON.parse(text);
    if (!body.choices || !body.choices[0] || !body.choices[0].message) {
      throw new Error('Unexpected OpenRouter response shape: ' + text.slice(0, 300));
    }
    const raw = body.choices[0].message.content;
    lastContent = Array.isArray(raw)
      ? raw.map((part) => (part && typeof part.text === 'string') ? part.text : '').join('')
      : (typeof raw === 'string' ? raw : '');
    if (lastContent.trim()) {
      return lastContent;
    }
    // Empty content: loop once more before giving up.
  }
  throw new Error('ox-alpha returned an empty response twice (all output went to its reasoning channel). Try again.');
}

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = ScriptProperties.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Open Settings and add your Anthropic API key.');
  }

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (response.status !== 200) {
    throw new Error('Claude API error ' + response.status + ': ' + text);
  }

  const body = JSON.parse(text);
  return body.content[0].text;
}

async function callOllama(systemPrompt, userPrompt, role) {
  const url = ScriptProperties.getProperty('OLLAMA_URL') || OLLAMA_URL_DEFAULT;
  const roleConfig = OLLAMA_ROLE_MODELS[role];
  const model = (roleConfig && ScriptProperties.getProperty(roleConfig.property)) ||
    (roleConfig && roleConfig.ollamaTag) ||
    ScriptProperties.getProperty('OLLAMA_MODEL') ||
    OLLAMA_MODEL_DEFAULT;

  const payload = {
    model: model,
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
    throw new Error('Ollama error ' + response.status + ': ' + text);
  }

  const body = JSON.parse(text);
  if (!body.choices || !body.choices[0] || !body.choices[0].message) {
    throw new Error('Unexpected Ollama response shape: ' + text.slice(0, 300));
  }
  return body.choices[0].message.content;
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

  const raw = await callLLM(systemPrompt, userPrompt, 'planner');
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

async function getPlan(userRequest, attachments, outputType) {
  const describe = OUTPUT_TYPE_COPY[outputType] || OUTPUT_TYPE_COPY.document;
  const systemPrompt = 'You are a planning assistant for an office document generator. ' +
    'Given a user\'s request and any reference material provided, respond with a short ' +
    '(2-4 sentence) plain-language plan describing ' + describe + '. If a reference item is ' +
    'tagged with a role, use "raw data" items as the source of facts/numbers to cite, mirror ' +
    'the structure/sections of an "output template" item, and match the tone and format of a ' +
    '"reference report/presentation" item. Plain sentences only — no code, XML, or markdown ' +
    'formatting.';
  return callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'orchestrator');
}

module.exports = {
  callLLM,
  callClaude,
  callOllama,
  callOpenRouter,
  buildAttachmentContext,
  classifyAttachments,
  parseAttachmentRoles,
  getPlan,
  OLLAMA_ROLE_MODELS
};
