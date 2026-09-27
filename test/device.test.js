const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDevice, applyOverrides, describeDevice } = require('../src/device');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  electron: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) open-teleprompter/1.0.0 Chrome/134.0.0.0 Electron/35.7.5 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
};

test('detects phones, tablets and desktops', () => {
  const iphone = detectDevice({ userAgent: UA.iphone, width: 393, height: 852, maxTouchPoints: 5, coarsePointer: true });
  assert.equal(iphone.formFactor, 'phone');
  assert.equal(iphone.os, 'ios');
  assert.equal(iphone.engine, 'webkit');

  // iPadOS reports a Mac user agent, but has touch points
  const ipad = detectDevice({ userAgent: UA.ipad, width: 820, height: 1180, maxTouchPoints: 5, coarsePointer: true });
  assert.equal(ipad.formFactor, 'tablet');
  assert.equal(ipad.os, 'ios');

  const mac = detectDevice({ userAgent: UA.ipad, width: 1512, height: 982, maxTouchPoints: 0 });
  assert.equal(mac.formFactor, 'desktop');
  assert.equal(mac.os, 'desktop');

  const pixel = detectDevice({ userAgent: UA.androidPhone, width: 412, height: 915, maxTouchPoints: 5, coarsePointer: true });
  assert.equal(pixel.formFactor, 'phone');
  assert.equal(pixel.os, 'android');
  assert.equal(pixel.engine, 'chromium');

  const tab = detectDevice({ userAgent: UA.androidTablet, width: 800, height: 1280, maxTouchPoints: 10, coarsePointer: true });
  assert.equal(tab.formFactor, 'tablet');

  const desktop = detectDevice({ userAgent: UA.electron, width: 1920, height: 1080 });
  assert.equal(desktop.formFactor, 'desktop');
  assert.equal(desktop.engine, 'chromium');
  assert.equal(detectDevice({ userAgent: UA.firefox }).engine, 'gecko');
});

test('sizes the text for the device', () => {
  const phone = detectDevice({ userAgent: UA.iphone, width: 393, height: 852 });
  const tablet = detectDevice({ userAgent: UA.ipad, width: 820, height: 1180, maxTouchPoints: 5 });
  const desktop = detectDevice({ userAgent: UA.electron, width: 1920, height: 1080 });
  assert.ok(tablet.layout.fontSize > phone.layout.fontSize);
  assert.ok(phone.layout.fontSize > desktop.layout.fontSize);
});

test('reduces effects on slow devices and for reduced motion', () => {
  const slow = detectDevice({ userAgent: UA.androidPhone, width: 360, height: 780, hardwareConcurrency: 2, deviceMemory: 2 });
  assert.equal(slow.tier, 'low');
  assert.deepEqual(slow.effects, { glow: false, animations: false });

  const fast = detectDevice({ userAgent: UA.electron, width: 1920, height: 1080, hardwareConcurrency: 12, deviceMemory: 16 });
  assert.equal(fast.tier, 'high');
  assert.deepEqual(fast.effects, { glow: true, animations: true });

  const calm = detectDevice({ userAgent: UA.electron, width: 1920, height: 1080, hardwareConcurrency: 8, reducedMotion: true });
  assert.deepEqual(calm.effects, { glow: true, animations: false });

  assert.deepEqual(applyOverrides(slow, { effects: 'full' }).effects, { glow: true, animations: true });
  assert.deepEqual(applyOverrides(fast, { effects: 'reduced' }).effects, { glow: false, animations: false });
});

test('tunes word tracking to the speech engine', () => {
  const desktop = detectDevice({ userAgent: UA.electron, width: 1920, height: 1080 });
  assert.equal(desktop.tracking.jumpMinMatches, 3);
  assert.equal(desktop.tracking.cumulativeResults, false);

  const ipad = detectDevice({ userAgent: UA.ipad, width: 820, height: 1180, maxTouchPoints: 5 });
  assert.equal(ipad.tracking.jumpMinMatches, 4);
  assert.equal(ipad.tracking.lookahead, 4);

  const android = detectDevice({ userAgent: UA.androidPhone, width: 412, height: 915 });
  assert.equal(android.tracking.cumulativeResults, true);

  // A chosen value wins over the device default; 0 means "auto"
  assert.equal(applyOverrides(ipad, { jumpMinMatches: 2 }).tracking.jumpMinMatches, 2);
  assert.equal(applyOverrides(ipad, { jumpMinMatches: 0 }).tracking.jumpMinMatches, 4);
});

test('describes the detected device', () => {
  const ipad = detectDevice({ userAgent: UA.ipad, width: 820, height: 1180, maxTouchPoints: 5 });
  assert.equal(describeDevice(ipad), 'Tablet · iOS/iPadOS · Safari/WebKit · medium performance');
});
