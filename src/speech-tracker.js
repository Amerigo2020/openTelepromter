// ==========================================
// SPEECH TRACKER
// Aligns recognized speech with the script for Word Tracking mode.
// Pure logic without DOM access, so it can be unit-tested with `npm test`.
//
// Rules:
// - The cursor follows the last word it heard, tolerating a few
//   unrecognized or skipped words right ahead (the lookahead).
// - Anything further away (skipping a sentence, restarting one) only
//   happens after several consecutive words match that other place
//   (jumpMinMatches) and none of them fit the current position.
// ==========================================

// Hesitation sounds the recognizer sometimes transcribes (normalized form)
const FILLERS = new Set(['ah', 'ahm', 'ohm', 'hm', 'hmm', 'mhm', 'uh', 'uhm', 'umm', 'erm']);

// Recognizers write small numbers as digits or as words; map both to digits
const NUMBER_WORDS = new Map(Object.entries({
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  null: '0', eins: '1', zwei: '2', drei: '3', vier: '4', funf: '5', sechs: '6',
  sieben: '7', acht: '8', neun: '9', zehn: '10', elf: '11', zwolf: '12',
}));

const DEFAULT_OPTIONS = {
  lookahead: 3,       // words the cursor may skip without extra evidence
  jumpMinMatches: 3,  // consecutive matching words needed for a jump
  maxPending: 8,      // unmatched spoken words kept as jump evidence
  maxSpokenGap: 1,    // extra spoken words allowed inside a matching run
  maxScriptGap: 2,    // script words allowed to be missing inside a run
};

function tokenize(text) {
  return String(text || '').split(/\s+/).filter(w => w.length > 0);
}

function isAnnotation(word) {
  // Bracketed text like [pause], [beat], [slide]
  if (/^\[.*\]$/.test(word)) return true;
  // Parenthesized stage directions
  if (/^\(.*\)$/.test(word)) return true;
  // Pure emoji (basic detection)
  if (/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/u.test(word)) return true;
  return false;
}

function normalizeWord(word) {
  const w = String(word).toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  return NUMBER_WORDS.get(w) || w;
}

// Words of 4+ letters (or numbers) are specific enough to trust on their own
function isDistinct(word) {
  return word.length >= 4 || /^\d+$/.test(word);
}

// Levenshtein distance, giving up once it exceeds maxDist
function editDistance(a, b, maxDist = Infinity) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return rowMin;
    prev = cur;
  }
  return prev[b.length];
}

// Fuzzy comparison of two normalized words
function wordsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  // Short words (der/den, in/an) must match exactly
  if (minLen <= 3) return false;
  // Inflections and compounds: "Video" / "Videos", "Reel" / "Reels"
  if (minLen / maxLen >= 0.6 && (a.startsWith(b) || b.startsWith(a))) return true;
  const tolerance = minLen <= 5 ? 1 : minLen <= 8 ? 2 : 3;
  if (maxLen - minLen > tolerance) return false;
  return editDistance(a, b, tolerance) <= tolerance;
}

class SpeechTracker {
  constructor(words, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.words = words;
    // Content words (no annotations) are addressed by "rank"
    this.contentNorm = [];
    this.contentIndex = [];
    // rankAt[i] = rank of the first content word at or after script index i
    this.rankAt = new Int32Array(words.length + 1);
    words.forEach((w, i) => {
      this.rankAt[i] = this.contentNorm.length;
      const norm = isAnnotation(w) ? '' : normalizeWord(w);
      if (norm) {
        this.contentIndex.push(i);
        this.contentNorm.push(norm);
      }
    });
    this.rankAt[words.length] = this.contentNorm.length;
    this._matchCache = new Map();
    this.committed = { cursor: 0, pending: [], jumps: 0, backJumps: 0 };
    this.cursor = 0;
    this._backJumps = 0;
    this._maxJumps = 0;
    this.newSession();
  }

  get totalWords() {
    return this.contentNorm.length;
  }

  // Includes jumps made on interim results, even if they were revised later
  get jumps() {
    return Math.max(this.committed.jumps, this._maxJumps);
  }

  // Number of content words before a script index
  wordsBefore(index) {
    return this.rankAt[Math.max(0, Math.min(index, this.words.length))];
  }

  // The recognizer restarted, so its result list starts from scratch
  newSession() {
    this._finalCount = 0;
    this._skipUntil = 0;
    this._seen = 0;
  }

  // Manual navigation (click, keys, new take). Speech heard so far must not
  // be re-applied at the new position.
  setCursor(index) {
    this.committed = { ...this.committed, cursor: index, pending: [] };
    this.cursor = index;
    this._backJumps = this.committed.backJumps;
    this._skipUntil = this._seen;
  }

  // finalWords: all finalized words of the current recognition session
  // interimWords: the current (unstable) hypothesis following them
  // Returns the script index of the next word to be spoken.
  update(finalWords, interimWords = []) {
    for (let i = this._finalCount; i < finalWords.length; i++) {
      if (i >= this._skipUntil) this.committed = this._step(this.committed, finalWords[i]);
    }
    this._finalCount = Math.max(this._finalCount, finalWords.length);

    // Interim words are applied tentatively; they may still be revised
    let state = this.committed;
    interimWords.forEach((w, k) => {
      if (finalWords.length + k >= this._skipUntil) state = this._step(state, w);
    });
    this._seen = finalWords.length + interimWords.length;

    // Revised interim results must not make the cursor flicker backwards;
    // only a deliberate backward jump may move it back.
    const jumpedBack = state.backJumps !== this._backJumps;
    this._backJumps = state.backJumps;
    this._maxJumps = Math.max(this._maxJumps, state.jumps);
    if (state.cursor > this.cursor || jumpedBack) this.cursor = state.cursor;
    return this.cursor;
  }

  _step(state, rawWord) {
    const word = normalizeWord(rawWord);
    if (!word || FILLERS.has(word)) return state;

    const { lookahead, jumpMinMatches, maxPending } = this.options;
    const seq = state.pending.concat(word).slice(-maxPending);
    const expected = this.wordsBefore(state.cursor);
    let near = null;
    let jump = null;

    for (const rank of this._matchSet(word)) {
      const d = rank - expected;
      const run = this._run(seq, rank);
      if (d >= -2 && d <= lookahead) {
        // Next word, a repeated word, or a few words skipped. Skipping needs
        // a distinct word or a second matching word.
        const needed = d <= 0 || isDistinct(word) ? 1 : 2;
        if (run.count >= needed && (!near || nearPriority(d) < nearPriority(near.d))) {
          near = { rank, d, count: run.count };
        }
      } else if (run.count >= jumpMinMatches && run.distinct) {
        if (!jump || run.count > jump.count || (run.count === jump.count && isCloser(d, jump.d))) {
          jump = { rank, d, count: run.count };
        }
      }
    }

    if (jump && (!near || jump.count >= near.count + 2)) {
      return {
        cursor: this.contentIndex[jump.rank] + 1,
        pending: [],
        jumps: state.jumps + 1,
        backJumps: state.backJumps + (jump.d < 0 ? 1 : 0),
      };
    }
    if (near) {
      // A repeated word (d < 0) confirms the position without moving it
      const cursor = near.d >= 0 ? this.contentIndex[near.rank] + 1 : state.cursor;
      return { ...state, cursor, pending: [] };
    }
    return { ...state, pending: seq };
  }

  // Longest in-order run of spoken words ending with seq[last] at `rank`
  _run(seq, rank) {
    const { maxSpokenGap, maxScriptGap } = this.options;
    const memo = new Map();
    const stride = this.contentNorm.length + 1;
    const visit = (i, r) => {
      const key = i * stride + r;
      if (memo.has(key)) return memo.get(key);
      let best = { count: 1, distinct: isDistinct(seq[i]) };
      for (let i2 = i - 1; i2 >= 0 && i2 >= i - 1 - maxSpokenGap; i2--) {
        const matches = this._matchSet(seq[i2]);
        for (let r2 = r - 1; r2 >= 0 && r2 >= r - 1 - maxScriptGap; r2--) {
          if (!matches.has(r2)) continue;
          const sub = visit(i2, r2);
          const distinct = sub.distinct || isDistinct(seq[i]);
          if (sub.count + 1 > best.count || (sub.count + 1 === best.count && distinct && !best.distinct)) {
            best = { count: sub.count + 1, distinct };
          }
        }
      }
      memo.set(key, best);
      return best;
    };
    return visit(seq.length - 1, rank);
  }

  // Ranks of all script words matching a spoken word (cached)
  _matchSet(word) {
    let set = this._matchCache.get(word);
    if (!set) {
      set = new Set();
      this.contentNorm.forEach((w, rank) => {
        if (wordsMatch(word, w)) set.add(rank);
      });
      if (this._matchCache.size > 2000) this._matchCache.clear();
      this._matchCache.set(word, set);
    }
    return set;
  }
}

// Next word first, then repeated words, then small skips ahead
function nearPriority(d) {
  return d === 0 ? 0 : d < 0 ? -d : d + 2;
}

function isCloser(d, other) {
  return Math.abs(d) < Math.abs(other) || (Math.abs(d) === Math.abs(other) && d > other);
}

module.exports = {
  SpeechTracker,
  tokenize,
  isAnnotation,
  normalizeWord,
  wordsMatch,
  editDistance,
};
