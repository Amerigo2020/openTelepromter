const { test } = require('node:test');
const assert = require('node:assert/strict');
const pip = require('../src/pip');

// 10 units per character, like a monospace font
const measure = text => text.length * 10;

test('breaks the script into lines that fit the window', () => {
  const words = pip.splitWords('one two three four five six seven');
  const lines = pip.layoutLines(words, measure, 140);
  assert.deepEqual(lines.map(l => l.text), ['one two three', 'four five six', 'seven']);
  assert.deepEqual(lines.map(l => [l.start, l.count]), [[0, 3], [3, 3], [6, 1]]);
});

test('keeps words longer than a line on their own line', () => {
  const lines = pip.layoutLines(['a', 'supercalifragilistic', 'b'], measure, 50);
  assert.deepEqual(lines.map(l => l.text), ['a', 'supercalifragilistic', 'b']);
});

test('moves the reading line at the classic speed after the countdown', () => {
  const lines = pip.layoutLines(pip.splitWords('one two three four five six seven'), measure, 140);
  const wps = 2;
  assert.equal(pip.linePosition(lines, wps, 0), 0);
  assert.equal(pip.linePosition(lines, wps, pip.LEAD_IN), 0);
  // 3 words read = first line done
  assert.equal(pip.linePosition(lines, wps, pip.LEAD_IN + 1.5), 1);
  assert.ok(Math.abs(pip.linePosition(lines, wps, pip.LEAD_IN + 2.25) - 1.5) < 1e-9);
  assert.equal(pip.linePosition(lines, wps, 1000), 3);
  assert.equal(pip.linePosition([], wps, 5), 0);
});

test('video lasts countdown + reading time + end', () => {
  assert.equal(pip.duration(30, 3), pip.LEAD_IN + 10 + pip.TAIL);
});

test('scene lays out text with the chosen size', () => {
  const ctx = { font: '', measureText: text => ({ width: text.length * 20 }) };
  const scene = pip.buildScene('hello world again', { size: 'large', wps: 3 }, ctx);
  assert.equal(scene.width, pip.SIZES.large.width);
  assert.ok(scene.lines.length >= 1);
  assert.equal(scene.duration, pip.duration(3, 3));
});
