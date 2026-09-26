const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SpeechTracker, tokenize, normalizeWord, wordsMatch } = require('../src/speech-tracker');

// Simulates one recognition session: final results accumulate,
// the interim hypothesis is replaced on every event
function session(tracker) {
  const finals = [];
  return {
    final(text) {
      finals.push(...tokenize(text));
      return tracker.update(finals, []);
    },
    interim(text) {
      return tracker.update(finals, tokenize(text));
    },
  };
}

// Feeds words one at a time and returns the cursor after each word
function sayWords(s, text) {
  return tokenize(text).map(w => s.final(w));
}

function tracker(text, options) {
  return new SpeechTracker(tokenize(text), options);
}

const REEL = 'Heute geht es um Reels. Erstens braucht ihr eine starke Hook am Anfang. '
  + 'Zweitens solltet ihr Untertitel verwenden. Drittens postet regelmäßig und bleibt dran.';

test('follows normal reading word by word', () => {
  const t = tracker('Hallo zusammen heute zeige ich euch drei Tipps für bessere Reels');
  const s = session(t);
  assert.deepEqual(sayWords(s, 'Hallo zusammen heute zeige ich euch drei Tipps für bessere Reels'),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('repeated interim results do not advance the cursor again', () => {
  const t = tracker('the cat and the dog and the bird and the fish');
  const s = session(t);
  for (let i = 0; i < 5; i++) assert.equal(s.interim('the'), 1);
  assert.equal(s.interim('the cat'), 2);
  for (let i = 0; i < 5; i++) assert.equal(s.interim('the cat and'), 3);
});

test('a common word does not pull the cursor ahead', () => {
  const t = tracker('we build a small app and we test the app with real users today');
  const s = session(t);
  sayWords(s, 'we build');
  assert.equal(s.final('and'), 2);
  assert.equal(s.final('small'), 4);
});

test('tolerates words the recognizer dropped', () => {
  const t = tracker('ich zeige euch heute drei Tipps');
  const s = session(t);
  assert.deepEqual(sayWords(s, 'ich zeige heute drei Tipps'), [1, 2, 4, 5, 6]);
});

test('jumps ahead only after three words clearly match a later sentence', () => {
  const t = tracker(REEL);
  const s = session(t);
  sayWords(s, 'Heute geht es um Reels');
  assert.equal(t.cursor, 5);
  // Skips the "Erstens" sentence
  assert.equal(s.final('Zweitens'), 5);
  assert.equal(s.final('solltet'), 5);
  assert.equal(s.final('ihr'), 16);
  assert.equal(s.final('Untertitel'), 17);
  assert.equal(t.jumps, 1);
});

test('jumps back when a sentence is restarted', () => {
  const t = tracker(REEL);
  const s = session(t);
  sayWords(s, 'Heute geht es um Reels');
  sayWords(s, 'Zweitens solltet ihr Untertitel verwenden');
  assert.equal(t.cursor, 18);
  assert.equal(s.final('Zweitens'), 18);
  assert.equal(s.final('solltet'), 18);
  assert.equal(s.final('ihr'), 16);
  assert.equal(s.final('Untertitel'), 17);
});

test('jump confidence is configurable', () => {
  const t = tracker(REEL, { jumpMinMatches: 4 });
  const s = session(t);
  sayWords(s, 'Heute geht es um Reels Zweitens solltet ihr');
  assert.equal(t.cursor, 5);
  assert.equal(s.final('Untertitel'), 17);
});

test('short filler words never cause a jump', () => {
  const t = tracker('Das ist der Plan und das ist die Idee und so ist es');
  const s = session(t);
  sayWords(s, 'Das ist der Plan');
  assert.deepEqual(sayWords(s, 'so ist es'), [4, 4, 4]);
});

test('ad-libbed words leave the cursor in place', () => {
  const t = tracker('Heute zeige ich euch meinen Workflow');
  const s = session(t);
  sayWords(s, 'Heute zeige');
  assert.deepEqual(sayWords(s, 'also ganz ehrlich Leute ähm'), [2, 2, 2, 2, 2]);
  assert.deepEqual(sayWords(s, 'ich euch'), [3, 4]);
});

test('manual navigation ignores speech heard before it', () => {
  const t = tracker(REEL);
  const s = session(t);
  assert.equal(s.interim('Heute geht es'), 3);
  t.setCursor(13);
  assert.equal(s.interim('Heute geht es um Reels'), 13);
  assert.equal(s.final('Heute geht es um Reels'), 13);
  assert.equal(s.final('Zweitens'), 14);
});

test('revised interim results do not move the cursor backwards', () => {
  const t = tracker('the quick brown fox jumps');
  const s = session(t);
  assert.equal(s.interim('the quick brown'), 3);
  assert.equal(s.interim('the quick bread'), 3);
  assert.equal(s.final('the quick brown fox'), 4);
});

test('a new recognition session continues from the cursor', () => {
  const t = tracker('eins zwei drei vier fünf sechs sieben');
  const s1 = session(t);
  sayWords(s1, 'eins zwei drei');
  t.newSession();
  const s2 = session(t);
  assert.deepEqual(sayWords(s2, 'vier fünf'), [4, 5]);
});

test('skips annotations and reaches the end of the script', () => {
  const t = tracker('Hallo [pause] Welt (lächeln) danke');
  const s = session(t);
  assert.deepEqual(sayWords(s, 'Hallo Welt danke'), [1, 3, 5]);
  assert.equal(t.totalWords, 3);
  assert.equal(t.wordsBefore(3), 2);
});

test('matches numbers, umlauts and inflections', () => {
  const t = tracker('Hier sind 3 Tipps für die Straße und Videos');
  const s = session(t);
  assert.equal(s.final('hier sind drei tipps fur die strasse und video'), 9);
});

test('normalizes and compares words', () => {
  assert.equal(normalizeWord('Reels!'), 'reels');
  assert.equal(normalizeWord('Größe,'), 'grosse');
  assert.equal(normalizeWord('Zwei'), '2');
  assert.ok(wordsMatch('teleprompter', 'teleprompters'));
  assert.ok(wordsMatch('workflow', 'workflo'));
  assert.ok(!wordsMatch('der', 'den'));
  assert.ok(!wordsMatch('haus', 'hausaufgaben'));
});
