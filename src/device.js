// ==========================================
// DEVICE PROFILE
// Detects what the app runs on (phone, tablet, desktop; iOS, Android;
// speech engine; performance) and derives defaults from it:
// - layout: font size, margins and reading line
// - effects: glow and animations, reduced on slow devices
// - tracking: how strict Word Tracking is with the local speech recognizer
// Pure logic without DOM access, so it can be unit-tested with `npm test`.
// ==========================================

const LAYOUTS = {
  phone: { fontSize: 28, padding: '12px 18px', focusLine: 0.25 },
  tablet: { fontSize: 40, padding: '20px 40px', focusLine: 0.3 },
  desktop: { fontSize: 22, padding: '10px 16px', focusLine: 0.3 },
};

const FORM_FACTOR_LABELS = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
const OS_LABELS = { ios: 'iOS/iPadOS', android: 'Android', desktop: 'Desktop OS' };
const ENGINE_LABELS = { webkit: 'Safari/WebKit', chromium: 'Chrome', gecko: 'Firefox', other: 'Browser' };

// env: { width, height, userAgent, maxTouchPoints, coarsePointer,
//        hardwareConcurrency, deviceMemory, reducedMotion }
function detectDevice(env = {}) {
  const ua = env.userAgent || '';
  const touchPoints = env.maxTouchPoints || 0;
  const shortSide = Math.min(env.width || 1024, env.height || 768);

  let os = 'desktop';
  let formFactor = 'desktop';
  if (/iPhone|iPod/.test(ua)) {
    os = 'ios';
    formFactor = 'phone';
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) {
    // iPadOS reports itself as a Mac
    os = 'ios';
    formFactor = 'tablet';
  } else if (/Android/.test(ua)) {
    os = 'android';
    // By screen size: unfolded foldables read like tablets
    formFactor = shortSide < 600 ? 'phone' : 'tablet';
  } else if (env.coarsePointer && !/Electron/.test(ua)) {
    formFactor = shortSide < 600 ? 'phone' : 'tablet';
  }

  // Touch-first: phones and tablets, not laptops that merely have a touch screen
  const touch = !!env.coarsePointer || os !== 'desktop';

  let engine = 'other';
  if (os === 'ios') engine = 'webkit';
  else if (/Firefox\//.test(ua)) engine = 'gecko';
  else if (/Chrome\/|Chromium\/|Electron\//.test(ua)) engine = 'chromium';
  else if (/AppleWebKit\//.test(ua)) engine = 'webkit';

  const cores = env.hardwareConcurrency || 4;
  const memory = env.deviceMemory; // not reported by Safari and Firefox
  let tier = 'mid';
  if (cores <= 2 || (memory && memory <= 2)) tier = 'low';
  else if (formFactor === 'desktop' && cores >= 8 && (!memory || memory >= 8)) tier = 'high';

  return {
    formFactor,
    os,
    engine,
    touch,
    tier,
    reducedMotion: !!env.reducedMotion,
    layout: { ...LAYOUTS[formFactor] },
    effects: effectsFor(tier, !!env.reducedMotion, 'auto'),
    tracking: trackingFor(os, engine),
  };
}

// override: 'auto' follows the device, 'full' and 'reduced' force a level
function effectsFor(tier, reducedMotion, override = 'auto') {
  if (override === 'full') return { glow: true, animations: true };
  if (override === 'reduced') return { glow: false, animations: false };
  return {
    glow: tier !== 'low',
    animations: tier !== 'low' && !reducedMotion,
  };
}

function trackingFor(os, engine) {
  const tracking = {
    lookahead: 3,
    jumpMinMatches: 3,
    // Android's recognizer repeats earlier results inside later ones
    cumulativeResults: os === 'android',
  };
  if (engine === 'webkit') {
    // Safari revises and drops more words: tolerate more gaps ahead,
    // but ask for more evidence before jumping elsewhere
    tracking.lookahead = 4;
    tracking.jumpMinMatches = 4;
  }
  return tracking;
}

// Applies user overrides to a detected profile
function applyOverrides(profile, { effects = 'auto', jumpMinMatches } = {}) {
  return {
    ...profile,
    effects: effectsFor(profile.tier, profile.reducedMotion, effects),
    tracking: {
      ...profile.tracking,
      jumpMinMatches: Number(jumpMinMatches) || profile.tracking.jumpMinMatches,
    },
  };
}

function describeDevice(profile) {
  const perf = { low: 'low', mid: 'medium', high: 'high' }[profile.tier];
  return `${FORM_FACTOR_LABELS[profile.formFactor]} · ${OS_LABELS[profile.os]} · ${ENGINE_LABELS[profile.engine]} · ${perf} performance`;
}

// Reads the environment of the current browser window
function browserEnv() {
  if (typeof window === 'undefined') return {};
  const media = q => !!(window.matchMedia && window.matchMedia(q).matches);
  return {
    width: window.screen ? window.screen.width : window.innerWidth,
    height: window.screen ? window.screen.height : window.innerHeight,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    coarsePointer: media('(pointer: coarse)'),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
  };
}

module.exports = {
  detectDevice,
  effectsFor,
  applyOverrides,
  describeDevice,
  browserEnv,
};
