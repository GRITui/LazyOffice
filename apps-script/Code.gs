var CLAUDE_MODEL = 'claude-sonnet-5';
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('LazyOffice — Document Assistant')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var LLM_PROVIDER_DEFAULT = 'claude'; // 'claude' | 'ollama'
var OLLAMA_URL_DEFAULT = 'http://localhost:11434/v1/chat/completions';
var OLLAMA_MODEL_DEFAULT = 'llama3.1';

/**
 * Single entry point every stage calls instead of callClaude directly.
 * Dispatches on the LLM_PROVIDER script property (defaults to "claude").
 * Set it to "ollama" to point this prototype at a local Ollama server for
 * iteration without an Anthropic API key — configure OLLAMA_URL/
 * OLLAMA_MODEL script properties to match your setup. This does not change
 * the default provider (owner confirmed 2026-07-09 staying on Claude); it's
 * a local-only dev toggle, not a swap to another hosted LLM API. A deployed
 * GAS Web App runs in Google's cloud and cannot reach "localhost" on your
 * machine, so "ollama" mode only works when OLLAMA_URL is a reachable
 * address (e.g. a tunnel), or when testing outside a real deployment.
 */
function callLLM(systemPrompt, userPrompt) {
  var provider = PropertiesService.getScriptProperties().getProperty('LLM_PROVIDER') || LLM_PROVIDER_DEFAULT;
  if (provider === 'ollama') {
    return callOllama(systemPrompt, userPrompt);
  }
  return callClaude(systemPrompt, userPrompt);
}

/**
 * Milestone 1 stand-in for the First Goal doc's 5-model pipeline. Owner
 * confirmed (2026-07-09) staying on the Claude API for now rather than
 * switching to another hosted LLM API as an intermediate step. Replace this
 * function with a call to the self-hosted inference server (TSK-002) once
 * that milestone lands — do not swap in a different hosted LLM API here.
 */
function callClaude(systemPrompt, userPrompt) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in Script Properties.');
  }

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };

  var response = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API error ' + code + ': ' + response.getContentText());
  }

  var body = JSON.parse(response.getContentText());
  return body.content[0].text;
}

/**
 * Local Ollama backend (OpenAI-compatible /v1/chat/completions), used only
 * when the LLM_PROVIDER script property is set to "ollama". No API key
 * required. See callLLM's comment for the localhost-reachability caveat.
 */
function callOllama(systemPrompt, userPrompt) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('OLLAMA_URL') || OLLAMA_URL_DEFAULT;
  var model = props.getProperty('OLLAMA_MODEL') || OLLAMA_MODEL_DEFAULT;

  var payload = {
    model: model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Ollama error ' + code + ': ' + response.getContentText());
  }

  var body = JSON.parse(response.getContentText());
  if (!body.choices || !body.choices[0] || !body.choices[0].message) {
    throw new Error('Unexpected Ollama response shape: ' + response.getContentText().slice(0, 300));
  }
  return body.choices[0].message.content;
}

/**
 * Stage 1 of the HITL flow: draft a short plain-language plan for the owner
 * to approve before anything is created in Drive.
 */
function getPlan(userRequest, attachments) {
  var systemPrompt = 'You are a planning assistant for an office document generator. ' +
    'Given a user\'s request and any reference material provided, respond with a short ' +
    '(2-4 sentence) plain-language plan describing the Google Doc you will create: its ' +
    'title and the sections/content it will contain. If a reference item is tagged with a ' +
    'role, use "raw data" items as the source of facts/numbers to cite, mirror the ' +
    'structure/sections of an "output template" item, and match the tone and format of a ' +
    '"reference report/presentation" item. Plain sentences only — no code, XML, or markdown ' +
    'formatting.';
  return callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments));
}

/**
 * Stage 2 of the HITL flow, run only after owner approval: draft document
 * content and create the real Google Doc.
 */
function generateDoc(userRequest, attachments) {
  var systemPrompt = 'You are a document content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone/format of a "reference report/presentation" ' +
    'item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  var raw = callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments));
  var parsed = parseDocumentJson(raw);

  var doc = DocumentApp.create(parsed.title);
  var body = doc.getBody();
  body.clear();
  body.appendParagraph(parsed.title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  parsed.sections.forEach(function (section) {
    if (section.heading) {
      body.appendParagraph(section.heading).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    }
    if (section.body) {
      body.appendParagraph(section.body);
    }
  });
  doc.saveAndClose();
  return doc.getUrl();
}

var MAX_INLINE_TEXT_CHARS = 4000;
var TEXT_MIME_PATTERN = /^text\/|json$|csv$/;
var TEXT_FILENAME_PATTERN = /\.(txt|md|csv|json)$/i;
var ROLE_VALUES = ['raw_data', 'template', 'reference_report', 'other'];
var ROLE_LABELS = {
  raw_data: 'raw data',
  template: 'output template',
  reference_report: 'reference report/presentation',
  other: 'other reference'
};

/**
 * Turns UI-attached files/links into extra prompt context. Follows the
 * Squad Setup doc's crash-proofing convention: best-effort per item, skip
 * or degrade to a filename-only reference instead of throwing on anything
 * unreadable or binary.
 */
function buildAttachmentContext(attachments) {
  if (!attachments || !attachments.length) {
    return '';
  }
  var parts = [];
  attachments.forEach(function (item) {
    if (!item) return;
    var roleTag = item.role ? ' [role: ' + (ROLE_LABELS[item.role] || item.role) + ']' : '';
    if (item.type === 'link' && item.url) {
      parts.push('Reference link' + roleTag + ': ' + item.url);
      return;
    }
    if (item.type === 'file' && item.name) {
      var isText = TEXT_MIME_PATTERN.test(item.mimeType || '') || TEXT_FILENAME_PATTERN.test(item.name);
      if (isText && item.base64) {
        try {
          var text = Utilities.newBlob(Utilities.base64Decode(item.base64)).getDataAsString();
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

/**
 * Classifies each UI-attached file/link as raw data, an output template, a
 * reference report/presentation, or other — so the plan/generate stages can
 * treat each attachment according to its actual purpose instead of lumping
 * them all together. The UI shows this to the owner for confirmation before
 * drafting the plan.
 */
function classifyAttachments(attachments) {
  if (!attachments || !attachments.length) {
    return [];
  }
  var systemPrompt = 'You classify reference files/links attached to a document-generation ' +
    'request. For each item, decide which single role it plays: "raw_data" (source ' +
    'numbers/facts to pull from), "template" (defines the structure, sections, or ' +
    'formatting the output should follow), "reference_report" (an example finished ' +
    'report/presentation similar to the desired final output), or "other" (none of the ' +
    'above). Respond ONLY with a JSON array of objects shaped ' +
    '{"id": string, "role": "raw_data"|"template"|"reference_report"|"other", ' +
    '"reason": string (max 12 words)}. No markdown, no commentary — just the JSON array.';

  var userPrompt = 'Classify these attachments:\n\n' + attachments.map(function (item) {
    if (item.type === 'link') {
      return 'id: ' + item.id + '\nlink: ' + item.url;
    }
    var descriptor = 'id: ' + item.id + '\nfilename: ' + item.name + '\ntype: ' + (item.mimeType || 'unknown');
    var isText = TEXT_MIME_PATTERN.test(item.mimeType || '') || TEXT_FILENAME_PATTERN.test(item.name || '');
    if (isText && item.base64) {
      try {
        var text = Utilities.newBlob(Utilities.base64Decode(item.base64)).getDataAsString();
        descriptor += '\nexcerpt: ' + text.slice(0, 500);
      } catch (err) {
        // no excerpt available; classify on filename/type alone
      }
    }
    return descriptor;
  }).join('\n\n');

  var raw = callLLM(systemPrompt, userPrompt);
  return parseAttachmentRoles(raw, attachments);
}

/**
 * Soft-fallback parsing of the role-classification response: pull the JSON
 * array out with a regex, validate each entry, and default anything
 * missing/malformed to "other" rather than throwing.
 */
function parseAttachmentRoles(raw, attachments) {
  var byId = {};
  var match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      var parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        parsed.forEach(function (entry) {
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
  return attachments.map(function (item) {
    return byId[item.id] || { id: item.id, role: 'other', reason: 'Could not classify automatically.' };
  });
}

/**
 * Soft-fallback JSON extraction per the Squad Setup doc's crash-proofing
 * convention: pull the object out with a regex rather than a strict parser,
 * and degrade to a plain document instead of throwing if it's malformed.
 */
function parseDocumentJson(raw) {
  var match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      var parsed = JSON.parse(match[0]);
      if (parsed && parsed.title && Array.isArray(parsed.sections)) {
        return parsed;
      }
    } catch (err) {
      // fall through to soft fallback below
    }
  }
  return { title: 'Untitled Document', sections: [{ heading: '', body: raw }] };
}
