var CLAUDE_MODEL = 'claude-sonnet-5';
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('LazyOffice — Document Assistant')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
 * Stage 1 of the HITL flow: draft a short plain-language plan for the owner
 * to approve before anything is created in Drive.
 */
function getPlan(userRequest) {
  var systemPrompt = 'You are a planning assistant for an office document generator. ' +
    'Given a user\'s request, respond with a short (2-4 sentence) plain-language plan ' +
    'describing the Google Doc you will create: its title and the sections/content it ' +
    'will contain. Plain sentences only — no code, XML, or markdown formatting.';
  return callClaude(systemPrompt, userRequest);
}

/**
 * Stage 2 of the HITL flow, run only after owner approval: draft document
 * content and create the real Google Doc.
 */
function generateDoc(userRequest) {
  var systemPrompt = 'You are a document content generator. Given a user\'s request, ' +
    'respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  var raw = callClaude(systemPrompt, userRequest);
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
