// Desktop equivalent of Code.gs's generateDoc + DocumentApp calls. No
// Google Drive/Docs dependency — writes a real .docx file to disk instead.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const { callLLM, buildAttachmentContext, parseDocumentJson } = require('./engine');

const OUTPUT_DIR = path.join(os.homedir(), 'Documents', 'LazyOffice');

function sanitizeFilename(title) {
  const base = (title || 'Untitled Document').replace(/[\\/:*?"<>|]/g, '-').trim();
  return (base || 'Untitled Document').slice(0, 120);
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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, sanitizeFilename(parsed.title) + '-' + Date.now() + '.docx');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Stage 2 of the HITL flow, run only after owner approval: draft document
 * content and write the .docx file. Same prompt/parsing logic as Code.gs's
 * generateDoc — only the "create the file" step differs (local .docx here
 * instead of DocumentApp.create in Drive).
 */
async function generateDoc(userRequest, attachments) {
  const systemPrompt = 'You are a document content generator. Given a user\'s request and any ' +
    'reference material (cite facts from "raw data" items, mirror the structure of an ' +
    '"output template" item, match the tone/format of a "reference report/presentation" ' +
    'item), respond ONLY with a JSON object of the form ' +
    '{"title": string, "sections": [{"heading": string, "body": string}]}. ' +
    'No markdown, no code fences, no commentary — just the JSON object.';
  const raw = await callLLM(systemPrompt, userRequest + buildAttachmentContext(attachments), 'code_engine');
  const parsed = parseDocumentJson(raw);
  return writeDocx(parsed);
}

module.exports = { generateDoc, OUTPUT_DIR };
