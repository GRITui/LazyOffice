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

/**
 * Soft-fallback JSON extraction per the Squad Setup doc's crash-proofing
 * convention: pull the object out with a regex rather than a strict parser,
 * and degrade to a plain single-item shape instead of throwing if malformed.
 */
function parseDocumentJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && parsed.title && Array.isArray(parsed.sections)) {
        return parsed;
      }
    } catch (err) {
      // fall through to soft fallback below
    }
  }
  return { title: 'Untitled Document', sections: [{ heading: '', body: raw }] };
}

function parseSpreadsheetJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && parsed.title && Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
        return parsed;
      }
    } catch (err) {
      // fall through to soft fallback below
    }
  }
  return { title: 'Untitled Spreadsheet', sheetName: 'Sheet1', headers: ['Content'], rows: [[raw]] };
}

function parseSlidesJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && parsed.title && Array.isArray(parsed.slides)) {
        return parsed;
      }
    } catch (err) {
      // fall through to soft fallback below
    }
  }
  return { title: 'Untitled Presentation', slides: [{ heading: 'Content', bullets: [raw] }] };
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

async function writePptx(parsed) {
  const pres = new PptxGenJS();

  const titleSlide = pres.addSlide();
  titleSlide.addText(parsed.title, { x: 0.6, y: 2.2, w: 8.8, fontSize: 32, bold: true, color: '2C3E8C' });

  parsed.slides.forEach((slide) => {
    const s = pres.addSlide();
    if (slide.heading) {
      s.addText(slide.heading, { x: 0.5, y: 0.35, w: 9, fontSize: 22, bold: true, color: '2C3E8C' });
    }
    if (Array.isArray(slide.bullets) && slide.bullets.length) {
      s.addText(
        slide.bullets.map((text) => ({ text: text })),
        { x: 0.6, y: 1.2, w: 8.8, fontSize: 16, bullet: true, color: '1A1A1A' }
      );
    }
  });

  const filePath = outputPath(parsed.title, 'Untitled Presentation', 'pptx');
  await pres.writeFile({ fileName: filePath });
  return filePath;
}

/**
 * Stage 2 of the HITL flow, run only after owner approval: draft document
 * content and write the .docx file. Same prompt/parsing logic as Code.gs's
 * generateDoc — only the "create the file" step differs (local .docx here
 * instead of DocumentApp.create in Drive).
 */
async function generateDocument(userRequest, attachments) {
  const systemPrompt = 'You are a document content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone/format of a "reference report/presentation" ' +
    'item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  return writeDocx(parseDocumentJson(raw));
}

async function generateSpreadsheet(userRequest, attachments) {
  const systemPrompt = 'You are a spreadsheet content generator. Given a user\'s request and any ' +
    'reference material (pull real numbers from "raw data" items, mirror the columns of an ' +
    '"output template" item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sheetName": string, "headers": [string, ...], ' +
    '"rows": [[string|number, ...], ...]} where every row array has the same length as ' +
    'headers. No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  return writeXlsx(parseSpreadsheetJson(raw));
}

async function generatePresentation(userRequest, attachments) {
  const systemPrompt = 'You are a presentation content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone of a "reference report/presentation" item), ' +
    'respond ONLY with a JSON object of the form {"title": string, "slides": ' +
    '[{"heading": string, "bullets": [string, ...]}, ...]}. Keep each slide to 3-5 short ' +
    'bullets. No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  return writePptx(parseSlidesJson(raw));
}

const GENERATORS = {
  document: generateDocument,
  spreadsheet: generateSpreadsheet,
  presentation: generatePresentation
};

/**
 * Single entry point the IPC layer calls. outputType is one of
 * 'document'|'spreadsheet'|'presentation' (defaults to 'document').
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
