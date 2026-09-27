// ==========================================
// TIMING
// Speaking-time estimates, learned speaking pace and Reel length targets.
// Shared by the control window and the prompter overlay.
// ==========================================

const { tokenize, isSpoken } = require('./speech-tracker');

const DEFAULT_WPM = 150;
const MIN_WPM = 60;
const MAX_WPM = 260;
// Weight of a new take when blending it into the learned pace
const LEARN_WEIGHT = 0.3;

function countWords(text) {
  const words = tokenize(text);
  const spoken = words.filter(isSpoken).length;
  return { all: words.length, spoken };
}

function clampWpm(wpm) {
  const n = Number(wpm);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WPM;
  return Math.min(MAX_WPM, Math.max(MIN_WPM, n));
}

// Words per minute the text will be spoken at in a given guidance mode
function modeWpm(settings) {
  if (settings.mode === 'classic' || settings.mode === 'voice') {
    return (Number(settings.speed) || 3) * 60;
  }
  return clampWpm(settings.learnedWpm);
}

// Classic scroll also spends time on annotations, the speech modes skip them
function estimateSeconds(text, settings) {
  const { all, spoken } = countWords(text);
  const count = settings.mode === 'classic' ? all : spoken;
  return count > 0 ? (count / modeWpm(settings)) * 60 : 0;
}

// Pace of a finished take, or null if the take is too short or implausible
function measureWpm(words, seconds) {
  if (words < 10 || seconds < 5) return null;
  const wpm = (words / seconds) * 60;
  return wpm >= MIN_WPM && wpm <= MAX_WPM ? wpm : null;
}

function blendWpm(learned, measured) {
  if (!measured) return learned || null;
  if (!learned) return measured;
  return learned * (1 - LEARN_WEIGHT) + measured * LEARN_WEIGHT;
}

// Expected total length of a running take, based on its pace so far
// Not clamped: scroll modes may run far outside a natural speaking pace
function projectSeconds(elapsed, wordsDone, wordsLeft, fallbackWpm) {
  const measured = wordsDone >= 10 && elapsed >= 5 ? (wordsDone / elapsed) * 60 : 0;
  const wpm = measured || Number(fallbackWpm) || DEFAULT_WPM;
  return elapsed + (wordsLeft / wpm) * 60;
}

// 'ok' fits the target, 'close' uses the last 10%, 'over' is too long
function targetStatus(seconds, target) {
  if (!target) return 'none';
  if (seconds > target) return 'over';
  if (seconds > target * 0.9) return 'close';
  return 'ok';
}

// Words to remove so the text fits the target at the given pace
function wordsToCut(seconds, target, wpm) {
  return Math.max(0, Math.ceil(((seconds - target) * wpm) / 60));
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = {
  DEFAULT_WPM,
  countWords,
  clampWpm,
  modeWpm,
  estimateSeconds,
  measureWpm,
  blendWpm,
  projectSeconds,
  targetStatus,
  wordsToCut,
  formatDuration,
};
