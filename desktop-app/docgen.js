// Desktop equivalent of Code.gs's generateDoc + DocumentApp calls, extended
// to the First Goal doc's other two output types. No Google Drive/Docs/
// Sheets/Slides dependency — writes real local files instead.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const XLSX = require('xlsx');
const PptxGenJS = require('pptxgenjs');
const { callLLM, buildAttachmentContext } = require('./engine');

const OUTPUT_DIR = path.join(os.homedir(), 'Documents', 'LazyOffice');

function sanitizeFilename(title, fallback) {
  const base = (title || fallback).replace(/[\\/:*?"<>|]/g, '-').trim();
  return (base || fallback).slice(0, 120);
}

function outputPath(title, fallback, extension) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  return path.join(OUTPUT_DIR, sanitizeFilename(title, fallback) + '-' + Date.now() + '.' + extension);
}

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
 * Soft-fallback JSON extraction per the Squad Setup doc's crash-proofing
 * convention, now with a repair step in the middle: if the model's raw
 * response doesn't parse into the expected schema, the Syntax Enforcer
 * (Phi-4-mini in the First Goal doc's pipeline) gets one attempt to
 * reformat it before degrading to a plain single-item fallback. Never
 * throws either way.
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
    '{"title": string, "slides": [{"heading": string, "bullets": [string, ...]}, ...]}',
    (p) => p && p.title && Array.isArray(p.slides),
    (text) => ({ title: 'Untitled Presentation', slides: [{ heading: 'Content', bullets: [text] }] })
  );
}

const OUTPUT_TYPE_NOUN = { document: 'document', spreadsheet: 'spreadsheet', presentation: 'presentation' };

/**
 * Stage 3 of the HITL flow, run after the file is already on disk: the
 * Generalist (Llama 3.1 8B Instruct in the First Goal doc's pipeline)
 * drafts a short delivery message. Soft-fails to a plain default message
 * rather than throwing — the file is already written by this point, so a
 * summarizer hiccup shouldn't block the user from getting it.
 */
async function summarizeResult(outputType, parsed, filePath) {
  const noun = OUTPUT_TYPE_NOUN[outputType] || 'file';
  const systemPrompt = 'You are a status summarizer for an office document generator. Given ' +
    'the ' + noun + ' that was just created and where it was saved, write a short (1-2 ' +
    'sentence) friendly confirmation message for the user — mention what was created and that ' +
    'it is ready to open. Plain sentences only, no markdown.';
  const userPrompt = 'Title: ' + parsed.title + '\nSaved to: ' + filePath;
  try {
    return await callLLM(systemPrompt, userPrompt, 'generalist');
  } catch (err) {
    return 'Your ' + noun + ' "' + parsed.title + '" is ready.';
  }
}

async function writeDocx(parsed) {
  const children = [new Paragraph({ text: parsed.title, heading: HeadingLevel.TITLE })];
  parsed.sections.forEach((section) => {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 }));
    }
    if (section.body) {
      children.push(new Paragraph({ text: section.body }));
    }
  });

  const doc = new Document({ sections: [{ children: children }] });
  const buffer = await Packer.toBuffer(doc);
  const filePath = outputPath(parsed.title, 'Untitled Document', 'docx');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function writeXlsx(parsed) {
  const rows = [parsed.headers, ...parsed.rows];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, (parsed.sheetName || 'Sheet1').slice(0, 31));
  const filePath = outputPath(parsed.title, 'Untitled Spreadsheet', 'xlsx');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

const THEME_ACCENT = '2C3E8C';
const THEME_MUTED = '8B8E97';
const THEME_RULE = 'D8D5CC';
const THEME_BRAND = 'LazyOffice';

/**
 * A light corporate theme applied to every generated deck: an accent-color
 * title slide, a thin accent band + brand/page-number footer on every
 * content slide. Slides with chart data (see parseSlidesJson) get a real
 * native pptxgenjs chart instead of bullets — not an image, an editable
 * chart object in the .pptx.
 */
async function writePptx(parsed) {
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

  const filePath = outputPath(parsed.title, 'Untitled Presentation', 'pptx');
  await pres.writeFile({ fileName: filePath });
  return filePath;
}

/**
 * Stage 2 of the HITL flow, run only after owner approval: draft document
 * content and write the .docx file. Same prompt/parsing logic as Code.gs's
 * generateDoc — only the "create the file" step differs (local .docx here
 * instead of DocumentApp.create in Drive). Returns { filePath, summary } —
 * see summarizeResult for the Generalist's role in the summary.
 */
async function generateDocument(userRequest, attachments) {
  const systemPrompt = 'You are a document content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone/format of a "reference report/presentation" ' +
    'item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseDocumentJson(raw);
  const filePath = await writeDocx(parsed);
  return { filePath: filePath, summary: await summarizeResult('document', parsed, filePath) };
}

async function generateSpreadsheet(userRequest, attachments) {
  const systemPrompt = 'You are a spreadsheet content generator. Given a user\'s request and any ' +
    'reference material (pull real numbers from "raw data" items, mirror the columns of an ' +
    '"output template" item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sheetName": string, "headers": [string, ...], ' +
    '"rows": [[string|number, ...], ...]} where every row array has the same length as ' +
    'headers. No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseSpreadsheetJson(raw);
  const filePath = writeXlsx(parsed);
  return { filePath: filePath, summary: await summarizeResult('spreadsheet', parsed, filePath) };
}

async function generatePresentation(userRequest, attachments) {
  const systemPrompt = 'You are a presentation content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone of a "reference report/presentation" item), ' +
    'respond ONLY with a JSON object of the form {"title": string, "slides": [SLIDE, ...]} ' +
    'where each SLIDE is either {"heading": string, "bullets": [string, ...]} (3-5 short ' +
    'bullets) or {"heading": string, "chart": {"categories": [string, ...], "values": ' +
    '[number, ...]}} for a single clear numeric comparison (e.g. a value per category). Use ' +
    'at most one chart slide, only when the data genuinely supports one. No markdown, no code ' +
    'fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = await parseSlidesJson(raw);
  const filePath = await writePptx(parsed);
  return { filePath: filePath, summary: await summarizeResult('presentation', parsed, filePath) };
}

const GENERATORS = {
  document: generateDocument,
  spreadsheet: generateSpreadsheet,
  presentation: generatePresentation
};

/**
 * Single entry point the IPC layer calls. outputType is one of
 * 'document'|'spreadsheet'|'presentation' (defaults to 'document'). Resolves
 * to { filePath, summary }.
 */
function generateOutput(userRequest, attachments, outputType) {
  const generator = GENERATORS[outputType] || GENERATORS.document;
  return generator(userRequest, attachments);
}

module.exports = {
  generateOutput,
  generateDocument,
  generateSpreadsheet,
  generatePresentation,
  parseDocumentJson,
  parseSpreadsheetJson,
  parseSlidesJson,
  OUTPUT_DIR
};
