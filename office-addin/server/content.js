// The real divergence from desktop-app/docgen.js: this server never writes
// a file to disk. Word and Excel get structured JSON back and the task
// pane inserts it directly into the live document via Office.js
// (Word.run/Excel.run) — there's no separate file, no "Documents" folder,
// because you're already inside the document. PowerPoint is the exception:
// Office.js has no rich "build N new themed slides" API the way Word/Excel
// let you write directly, so for presentations this still builds a real
// .pptx server-side (reusing the same pptxgenjs corporate theme as
// desktop-app) and hands it back as base64 for the task pane to merge in
// via context.presentation.insertSlidesFromBase64 — see taskpane.js for
// the important caveat on that specific API.

const PptxGenJS = require('pptxgenjs');
const { callLLM, buildAttachmentContext } = require('./engine');

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

/**
 * Same crash-proofing convention as desktop-app/docgen.js: the Syntax
 * Enforcer (Phi-4-mini) gets one repair attempt before degrading to a
 * plain fallback shape. Never throws.
 */
async function parseWithSchema(raw, schemaDescription, isValid, fallback) {
  let parsed = extractJson(raw);
  if (parsed && isValid(parsed)) {
    return parsed;
  }

  try {
    const repairPrompt = 'Convert the following text into valid JSON matching exactly this ' +
      'shape: ' + schemaDescription + '. If it already contains matching JSON, extract and ' +
      'return it verbatim. Respond ONLY with the JSON object — no markdown, no commentary.';
    const repaired = await callLLM(repairPrompt, raw, 'syntax_enforcer');
    parsed = extractJson(repaired);
    if (parsed && isValid(parsed)) {
      return parsed;
    }
  } catch (err) {
    // repair attempt failed (e.g. Ollama unreachable) — fall through to fallback
  }

  return fallback(raw);
}

function parseDocumentJson(raw) {
  return parseWithSchema(
    raw,
    '{"title": string, "sections": [{"heading": string, "body": string}, ...]}',
    (p) => p && p.title && Array.isArray(p.sections),
    (text) => ({ title: 'Untitled Document', sections: [{ heading: '', body: text }] })
  );
}

function parseSpreadsheetJson(raw) {
  return parseWithSchema(
    raw,
    '{"title": string, "sheetName": string, "headers": [string, ...], ' +
      '"rows": [[string|number, ...], ...]} (every row array the same length as headers)',
    (p) => p && p.title && Array.isArray(p.headers) && Array.isArray(p.rows),
    (text) => ({ title: 'Untitled Spreadsheet', sheetName: 'Sheet1', headers: ['Content'], rows: [[text]] })
  );
}

function parseSlidesJson(raw) {
  return parseWithSchema(
    raw,
    '{"title": string, "slides": [SLIDE, ...]} where each SLIDE is either ' +
      '{"heading": string, "bullets": [string, ...]} or {"heading": string, ' +
      '"chart": {"categories": [string, ...], "values": [number, ...]}}',
    (p) => p && p.title && Array.isArray(p.slides),
    (text) => ({ title: 'Untitled Presentation', slides: [{ heading: 'Content', bullets: [text] }] })
  );
}

const OUTPUT_TYPE_NOUN = { document: 'document', spreadsheet: 'spreadsheet', presentation: 'presentation' };

/**
 * The Generalist's (Llama 3.1 8B) delivery message — same soft-fail
 * convention as desktop-app: the content already exists by this point, so
 * a summarizer hiccup shouldn't block delivery.
 */
async function summarizeResult(outputType, parsed) {
  const noun = OUTPUT_TYPE_NOUN[outputType] || 'content';
  const systemPrompt = 'You are a status summarizer for an office document generator. Given ' +
    'the ' + noun + ' about to be inserted into the user\'s open document, write a short ' +
    '(1-2 sentence) friendly confirmation message — mention what was created. Plain sentences ' +
    'only, no markdown.';
  const userPrompt = 'Title: ' + parsed.title;
  try {
    return await callLLM(systemPrompt, userPrompt, 'generalist');
  } catch (err) {
    return 'Your ' + noun + ' "' + parsed.title + '" is ready to insert.';
  }
}

const THEME_ACCENT = '2C3E8C';
const THEME_MUTED = '8B8E97';
const THEME_RULE = 'D8D5CC';
const THEME_BRAND = 'LazyOffice';

/**
 * Builds a real themed .pptx in memory (same corporate theme as
 * desktop-app/docgen.js's writePptx: accent title slide, branded footer,
 * native chart for chart slides) and returns it as base64 for
 * insertSlidesFromBase64 — nothing is written to disk here.
 */
async function buildPptxBase64(parsed) {
  const pres = new PptxGenJS();

  const titleSlide = pres.addSlide();
  titleSlide.background = { color: THEME_ACCENT };
  titleSlide.addText(parsed.title, { x: 0.6, y: 2.0, w: 8.8, fontSize: 32, bold: true, color: 'FFFFFF' });
  titleSlide.addText('Prepared by ' + THEME_BRAND, { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: 'D9DEF2' });

  const totalSlides = parsed.slides.length + 1;
  parsed.slides.forEach((slide, index) => {
    const s = pres.addSlide();
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: THEME_ACCENT }, line: { color: THEME_ACCENT, width: 0 } });
    if (slide.heading) {
      s.addText(slide.heading, { x: 0.5, y: 0.35, w: 9, fontSize: 22, bold: true, color: THEME_ACCENT });
    }
    if (slide.chart && Array.isArray(slide.chart.categories) && Array.isArray(slide.chart.values)) {
      s.addChart(pres.ChartType.bar, [
        { name: slide.heading || 'Data', labels: slide.chart.categories, values: slide.chart.values }
      ], { x: 0.6, y: 1.2, w: 8.5, h: 4.6, chartColors: [THEME_ACCENT], showValue: true });
    } else if (Array.isArray(slide.bullets) && slide.bullets.length) {
      s.addText(
        slide.bullets.map((text) => ({ text: text })),
        { x: 0.6, y: 1.2, w: 8.8, fontSize: 16, bullet: true, color: '1A1A1A' }
      );
    }
    s.addShape(pres.ShapeType.rect, { x: 0, y: 6.9, w: '100%', h: 0.02, fill: { color: THEME_RULE }, line: { color: THEME_RULE, width: 0 } });
    s.addText(THEME_BRAND, { x: 0.5, y: 6.95, w: 4, fontSize: 9, color: THEME_MUTED });
    s.addText((index + 2) + ' / ' + totalSlides, { x: 8.7, y: 6.95, w: 1, fontSize: 9, color: THEME_MUTED, align: 'right' });
  });

  return pres.write({ outputType: 'base64' });
}

async function generateDocumentContent(userRequest, attachments) {
  const systemPrompt = 'You are a document content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone/format of a "reference report/presentation" ' +
    'item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseDocumentJson(raw);
  return { outputType: 'document', parsed: parsed, summary: await summarizeResult('document', parsed) };
}

async function generateSpreadsheetContent(userRequest, attachments) {
  const systemPrompt = 'You are a spreadsheet content generator. Given a user\'s request and any ' +
    'reference material (pull real numbers from "raw data" items, mirror the columns of an ' +
    '"output template" item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sheetName": string, "headers": [string, ...], ' +
    '"rows": [[string|number, ...], ...]} where every row array has the same length as ' +
    'headers. No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseSpreadsheetJson(raw);
  return { outputType: 'spreadsheet', parsed: parsed, summary: await summarizeResult('spreadsheet', parsed) };
}

async function generatePresentationContent(userRequest, attachments) {
  const systemPrompt = 'You are a presentation content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone of a "reference report/presentation" item), ' +
    'respond ONLY with a JSON object of the form {"title": string, "slides": [SLIDE, ...]} ' +
    'where each SLIDE is either {"heading": string, "bullets": [string, ...]} (3-5 short ' +
    'bullets) or {"heading": string, "chart": {"categories": [string, ...], "values": ' +
    '[number, ...]}} for a single clear numeric comparison. Use at most one chart slide, ' +
    'only when the data genuinely supports one. No markdown, no code fences, no commentary — ' +
    'just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseSlidesJson(raw);
  const pptxBase64 = await buildPptxBase64(parsed);
  return { outputType: 'presentation', parsed: parsed, pptxBase64: pptxBase64, summary: await summarizeResult('presentation', parsed) };
}

const GENERATORS = {
  document: generateDocumentContent,
  spreadsheet: generateSpreadsheetContent,
  presentation: generatePresentationContent
};

function generateContent(userRequest, attachments, outputType) {
  const generator = GENERATORS[outputType] || GENERATORS.document;
  return generator(userRequest, attachments);
}

module.exports = {
  generateContent,
  generateDocumentContent,
  generateSpreadsheetContent,
  generatePresentationContent,
  parseDocumentJson,
  parseSpreadsheetJson,
  parseSlidesJson
};
