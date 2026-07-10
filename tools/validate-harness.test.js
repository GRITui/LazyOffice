'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseBacklog, readyForPm } = require('./validate-harness.js');

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL ' + name);
    console.error('  ' + err.message);
  }
}

test('T1: unclosed <status> tag skipped with warning, sibling entry intact', () => {
  const text = [
    '<task_item>',
    '  <id>TSK-A</id>',
    '  <status>IN_PROGRESS',
    '  <title>Broken entry</title>',
    '</task_item>',
    '<task_item>',
    '  <id>TSK-B</id>',
    '  <status>READY_FOR_PM</status>',
    '  <title>Healthy sibling</title>',
    '</task_item>',
  ].join('\n');
  const { tasks, warnings } = parseBacklog(text);
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].id, 'TSK-B');
  assert.strictEqual(tasks[0].status, 'READY_FOR_PM');
  assert.strictEqual(tasks[0].title, 'Healthy sibling');
  assert.strictEqual(warnings.length, 1);
  assert.ok(/status/.test(warnings[0]), 'warning names the bad field: ' + warnings[0]);
});

test('T2: noise-only block skipped with warning', () => {
  const { tasks, warnings } = parseBacklog('<task_item>lorem ipsum ??? {not:json}</task_item>');
  assert.strictEqual(tasks.length, 0);
  assert.strictEqual(warnings.length, 1);
});

test('T3: prose outside any block ignored, no warning', () => {
  const text = 'Do not edit outside the XML tags.\n\n<task_item>\n<id>X-1</id>\n<status>DONE</status>\n<title>t</title>\n</task_item>\n\ntrailing owner notes here';
  const { tasks, warnings } = parseBacklog(text);
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(warnings.length, 0);
});

test('T4: well-formed entry has all fields extracted', () => {
  const text = [
    '<task_item>',
    '  <id>TSK-9</id>',
    '  <source>OWNER_POPUP</source>',
    '  <status>READY_FOR_PM</status>',
    '  <priority>HIGH</priority>',
    '  <title>Full entry</title>',
    '  <description>Multi',
    'line body</description>',
    '  <researcher_notes>looks feasible</researcher_notes>',
    '</task_item>',
  ].join('\n');
  const { tasks, warnings } = parseBacklog(text);
  assert.strictEqual(warnings.length, 0);
  assert.deepStrictEqual(tasks, [{
    id: 'TSK-9',
    source: 'OWNER_POPUP',
    status: 'READY_FOR_PM',
    priority: 'HIGH',
    title: 'Full entry',
    description: 'Multi\nline body',
    researcher_notes: 'looks feasible',
  }]);
});

test('T5: readyForPm excludes non-READY_FOR_PM statuses', () => {
  const tasks = [
    { id: 'A', status: 'READY_FOR_PM', title: 'a' },
    { id: 'B', status: 'NEEDS_OWNER_REVIEW', title: 'b' },
    { id: 'C', status: 'DONE', title: 'c' },
  ];
  const ready = readyForPm(tasks);
  assert.deepStrictEqual(ready.map((t) => t.id), ['A']);
});

test('T6: parseBacklog never throws on garbage input', () => {
  const junk = Buffer.from(Array.from({ length: 512 }, () => Math.floor(Math.random() * 256))).toString('binary');
  for (const input of [null, undefined, 42, '', junk]) {
    const result = parseBacklog(input);
    assert.ok(Array.isArray(result.tasks), 'tasks is an array');
    assert.ok(Array.isArray(result.warnings), 'warnings is an array');
  }
});

test('T7: real backlog-inbox.md parses with TSK-001..004 and zero warnings', () => {
  const file = path.join(__dirname, '..', 'backlog-inbox.md');
  const { tasks, warnings } = parseBacklog(fs.readFileSync(file, 'utf8'));
  assert.ok(tasks.length >= 4, 'at least 4 tasks, got ' + tasks.length);
  const ids = tasks.map((t) => t.id);
  for (const id of ['TSK-001', 'TSK-002', 'TSK-003', 'TSK-004']) {
    assert.ok(ids.includes(id), 'missing ' + id);
  }
  assert.strictEqual(warnings.length, 0, 'unexpected warnings: ' + warnings.join(' | '));
});

if (failed > 0) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('All tests passed');
