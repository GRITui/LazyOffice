#!/usr/bin/env node
'use strict';

const FIELDS = ['id', 'source', 'status', 'priority', 'title', 'description', 'researcher_notes'];
const REQUIRED = ['id', 'status', 'title'];

function extractField(block, field) {
  const m = block.match(new RegExp('<' + field + '>([\\s\\S]*?)</' + field + '>'));
  return m ? m[1].trim() : null;
}

function parseBacklog(text) {
  const tasks = [];
  const warnings = [];
  if (typeof text !== 'string') {
    warnings.push('parseBacklog: expected a string, got ' + (text === null ? 'null' : typeof text) + '; skipping');
    return { tasks, warnings };
  }
  // Match <task_item> blocks first, then extract fields within each block's own
  // text, so an unclosed tag in one entry can't bleed a match into a sibling.
  const blockRe = /<task_item>([\s\S]*?)<\/task_item>/g;
  let m;
  let index = 0;
  while ((m = blockRe.exec(text)) !== null) {
    index++;
    const block = m[1];
    const task = {};
    for (const field of FIELDS) {
      const value = extractField(block, field);
      if (value !== null) task[field] = value;
    }
    const missing = REQUIRED.filter((f) => !(f in task));
    if (missing.length > 0) {
      warnings.push(
        'task_item #' + index + (task.id ? ' (' + task.id + ')' : '') +
        ': missing or unclosed required tag(s): ' + missing.join(', ') + '; entry skipped'
      );
      continue;
    }
    tasks.push(task);
  }
  return { tasks, warnings };
}

function readyForPm(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((t) => t && t.status === 'READY_FOR_PM');
}

function main() {
  const fs = require('fs');
  const path = require('path');
  const file = process.argv[2] || path.join(__dirname, '..', 'backlog-inbox.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('error: cannot read ' + file + ': ' + err.message);
    process.exit(1);
  }
  const { tasks, warnings } = parseBacklog(text);
  console.log('Backlog: ' + file);
  console.log('Tasks parsed: ' + tasks.length + ' (' + readyForPm(tasks).length + ' READY_FOR_PM)');
  for (const t of tasks) {
    console.log('  ' + t.id + '  [' + t.status + ']  ' + t.title);
  }
  if (warnings.length > 0) {
    console.log('Warnings: ' + warnings.length);
    for (const w of warnings) console.log('  warning: ' + w);
  } else {
    console.log('Warnings: none');
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { parseBacklog, readyForPm };
