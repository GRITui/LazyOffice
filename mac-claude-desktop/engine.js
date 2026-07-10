// This track has exactly one backend: the user's own Claude Desktop app,
// driven via Chrome DevTools Protocol (CDP) instead of the Anthropic API or
// a local Ollama server. There is no provider switch here — unlike
// desktop-app/engine.js, which chooses between Ollama and a Claude CLI, this
// file's only job is talking to Claude Desktop.
//
// THIS IS UNVERIFIED AGAINST A REAL CLAUDE DESKTOP APP. It's built from a
// third-party proof-of-concept (github.com/epiccoleman/claude-automator),
// not official Anthropic documentation — Claude Desktop exposes no supported
// automation surface. The CSS selectors below are scraped from that PoC's
// snapshot of the Claude Desktop UI and WILL break the moment Anthropic
// changes that UI. See README.md for the full risk writeup before relying on
// this for anything real.

const { ScriptProperties } = require('./config-store');

const CDP_PORT_DEFAULT = 9222;
const CDP_HOST_DEFAULT = '127.0.0.1';
const RESPONSE_TIMEOUT_MS = 45000;
const POLL_INTERVAL_MS = 1000;
const STABLE_POLLS_REQUIRED = 2; // consecutive unchanged polls before we call a response "done"

// Selectors lifted from the claude-automator PoC — not documented by
// Anthropic, not guaranteed to match any given Claude Desktop version.
const SEL_INPUT = 'div[contenteditable="true"]';
const SEL_SEND_BUTTON = 'button[aria-label*="Send"]';
const SEL_MESSAGE = 'div.font-claude-message';
const SEL_NEW_CHAT_BUTTON = 'button[aria-label*="New chat"], a[href="/new"]';

let cachedBrowser = null;

function cdpUrl() {
  const host = ScriptProperties.getProperty('CLAUDE_DESKTOP_CDP_HOST') || CDP_HOST_DEFAULT;
  const port = ScriptProperties.getProperty('CLAUDE_DESKTOP_CDP_PORT') || CDP_PORT_DEFAULT;
  return 'http://' + host + ':' + port;
}

// playwright-core only (no bundled browser download) — we never launch a
// browser ourselves, we attach to Claude Desktop's own embedded Chromium via
// its remote-debugging port. See README.md for the exact launch command this
// requires; LazyOffice does not (and should not) start Claude Desktop for
// you or silently enable its debug port.
async function getBrowser() {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  const { chromium } = require('playwright-core');
  try {
    cachedBrowser = await chromium.connectOverCDP(cdpUrl());
  } catch (err) {
    throw new Error(
      'Could not reach Claude Desktop at ' + cdpUrl() + '. Claude Desktop must already be running ' +
      'with remote debugging enabled — quit it, then relaunch from a terminal with:\n\n' +
      '  "/Applications/Claude.app/Contents/MacOS/Claude" --remote-debugging-port=' +
      (ScriptProperties.getProperty('CLAUDE_DESKTOP_CDP_PORT') || CDP_PORT_DEFAULT) +
      '\n\nthen try again. (' + err.message + ')'
    );
  }
  return cachedBrowser;
}

// Finds the Claude Desktop window among the attached browser's open pages.
// Unverified assumption: Claude Desktop (an Electron app) exposes its main
// window as a normal CDP target/page — if it uses multiple internal frames
// or a different window structure, this will need adjusting against the
// real app.
async function getClaudeDesktopPage(browser) {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    if (pages.length) return pages[0];
  }
  throw new Error('Claude Desktop is running with remote debugging enabled, but no window was found to attach to. Make sure a Claude Desktop window is open.');
}

// Best-effort: start a fresh conversation so each call is self-contained and
// earlier calls' content never leaks into a later, unrelated one. Never
// throws — if the button isn't found (selector drift, or already a blank
// conversation), we proceed with whatever conversation is currently open.
async function startNewConversation(page) {
  try {
    const btn = page.locator(SEL_NEW_CHAT_BUTTON).first();
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      await page.waitForTimeout(500);
    }
  } catch (err) {
    // no new-chat control found — continue in whatever conversation is open
  }
}

async function sendPrompt(page, systemPrompt, userPrompt) {
  // Claude Desktop's chat box has no separate system-prompt field, unlike
  // the Messages API or the Claude CLI's --append-system-prompt — both
  // prompts are folded into one message with an explicit delimiter.
  const combined = '[SYSTEM INSTRUCTIONS]\n' + systemPrompt + '\n[END SYSTEM INSTRUCTIONS]\n\n' + userPrompt;
  const input = page.locator(SEL_INPUT).first();
  await input.click();
  await input.fill(combined);
  await page.locator(SEL_SEND_BUTTON).first().click();
}

// No streaming, no completion event to listen for — polls the DOM and
// treats a message whose text hasn't changed across two consecutive polls
// as finished. Deliberately conservative (bounded by RESPONSE_TIMEOUT_MS)
// since a false "done" would silently truncate the response.
async function waitForResponse(page) {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastText = null;
  let stableCount = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const messages = page.locator(SEL_MESSAGE);
    const count = await messages.count();
    if (count === 0) continue;

    const text = await messages.nth(count - 1).innerText();
    if (text && text === lastText) {
      stableCount++;
      if (stableCount >= STABLE_POLLS_REQUIRED) return text;
    } else {
      stableCount = 0;
      lastText = text;
    }
  }

  if (lastText) return lastText; // best-effort: return whatever we have rather than fail outright
  throw new Error('Claude Desktop did not respond within ' + Math.round(RESPONSE_TIMEOUT_MS / 1000) + 's.');
}

/**
 * The only LLM entry point for this track — every role (attachment
 * classification, plan drafting, content generation, delivery summary,
 * syntax repair) calls this directly. Each call is stateless: it starts a
 * fresh Claude Desktop conversation, sends systemPrompt+userPrompt as one
 * message, and returns the response text once it stabilizes.
 */
async function callLLM(systemPrompt, userPrompt) {
  const browser = await getBrowser();
  const page = await getClaudeDesktopPage(browser);
  await startNewConversation(page);
  await sendPrompt(page, systemPrompt, userPrompt);
  return waitForResponse(page);
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

// Same circuit breaker as desktop-app/engine.js's clarification loop: after
// this many rounds, stop asking and draft the best plan possible.
const MAX_CLARIFICATION_ROUNDS = 3;

function buildClarificationContext(clarifications) {
  if (!clarifications || !clarifications.length) return '';
  const lines = clarifications.map((c, i) =>
    'Q' + (i + 1) + ': ' + c.question + '\nA' + (i + 1) + ': ' + (c.answer || '(no answer given)'));
  return '\n\nClarification so far:\n' + lines.join('\n');
}

/**
 * Stage 1 of the HITL flow, same shape as desktop-app's getPlan (clarify
 * proactively, then draft), but every call — including this one — goes
 * through the single callLLM above. There's no separate "always local"
 * bypass here, because there's no second backend to bypass.
 */
async function getPlan(userRequest, attachments, outputType, clarifications) {
  const describe = OUTPUT_TYPE_COPY[outputType] || OUTPUT_TYPE_COPY.document;
  const forceReady = (clarifications || []).length >= MAX_CLARIFICATION_ROUNDS;
  const systemPrompt = 'You are a planning assistant for an office document generator. Given a ' +
    'user\'s request and any reference material, first judge whether you have enough detail to ' +
    'confidently plan ' + describe + '. ' +
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
  const raw = await callLLM(systemPrompt, userPrompt);
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

// Lightweight connectivity check for the renderer's status panel — attempts
// the CDP connection and reports success/failure without sending any prompt,
// so a broken setup shows a clear message before the user tries a real
// request.
async function checkStatus() {
  try {
    const browser = await getBrowser();
    const page = await getClaudeDesktopPage(browser);
    return { connected: true, url: cdpUrl(), title: await page.title().catch(() => null) };
  } catch (err) {
    return { connected: false, url: cdpUrl(), error: err.message };
  }
}

module.exports = {
  callLLM,
  buildAttachmentContext,
  classifyAttachments,
  parseAttachmentRoles,
  getPlan,
  checkStatus
};
