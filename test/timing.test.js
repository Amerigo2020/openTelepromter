const { test } = require('node:test');
const assert = require('node:assert/strict');
const timing = require('../src/timing');

const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('counts spoken words without annotations', () => {
  assert.deepEqual(timing.countWords('Hallo [pause] Welt'), { all: 3, spoken: 2 });
  assert.deepEqual(timing.countWords('  '), { all: 0, spoken: 0 });
});

test('estimates word tracking from the learned pace', () => {
  assert.equal(timing.estimateSeconds(words(150), { mode: 'word-tracking', learnedWpm: 150 }), 60);
  assert.equal(timing.estimateSeconds(words(90), { mode: 'word-tracking', learnedWpm: 180 }), 30);
  // No pace learned yet: default of 150 wpm
  assert.equal(timing.estimateSeconds(words(75), { mode: 'word-tracking' }), 30);
});

test('estimates scroll modes from the speed setting', () => {
  assert.equal(timing.estimateSeconds(words(30), { mode: 'classic', speed: 3 }), 10);
  assert.equal(timing.estimateSeconds(`${words(30)} [pause]`, { mode: 'classic', speed: 3 }), 31 / 3);
  assert.equal(timing.estimateSeconds(`${words(30)} [pause]`, { mode: 'voice', speed: 3 }), 10);
});

test('measures and learns the speaking pace', () => {
  assert.equal(timing.measureWpm(5, 10), null);
  assert.equal(timing.measureWpm(50, 3), null);
  assert.equal(timing.measureWpm(50, 20), 150);
  assert.equal(timing.measureWpm(200, 20), null);
  assert.equal(timing.blendWpm(null, 170), 170);
  assert.equal(timing.blendWpm(150, null), 150);
  assert.equal(timing.blendWpm(150, 180), 159);
});

test('projects the total length of a running take', () => {
  assert.equal(timing.projectSeconds(10, 25, 50, 100), 30);
  // Too early to measure: falls back to the given pace
  assert.equal(timing.projectSeconds(2, 3, 150, 150), 62);
});

test('rates a length against the Reel target', () => {
  assert.equal(timing.targetStatus(25, 30), 'ok');
  assert.equal(timing.targetStatus(28, 30), 'close');
  assert.equal(timing.targetStatus(31, 30), 'over');
  assert.equal(timing.targetStatus(31, 0), 'none');
  assert.equal(timing.wordsToCut(36, 30, 150), 15);
  assert.equal(timing.wordsToCut(30.1, 30, 150), 1);
  assert.equal(timing.wordsToCut(25, 30, 150), 0);
});

test('formats durations', () => {
  assert.equal(timing.formatDuration(0), '0:00');
  assert.equal(timing.formatDuration(65.4), '1:05');
  assert.equal(timing.formatDuration(-3), '0:00');
});

test('projects fast scroll speeds beyond a natural speaking pace', () => {
  // Classic Scroll at 8 words/sec: 200 words take 25 s
  assert.equal(timing.projectSeconds(0, 0, 200, 480), 25);
  assert.equal(timing.projectSeconds(10, 80, 120, 480), 25);
});

test('punctuation-only tokens are not spoken words', () => {
  assert.deepEqual(timing.countWords('Hallo ... Welt ---'), { all: 4, spoken: 2 });
});
