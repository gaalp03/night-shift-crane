// Device detection at launch (plain Node: the browser environment is faked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice } from '../src/core/device.js';

/** A fake window: user agent, touch points, which media queries match, screen size. */
function env({ ua = '', points = 0, media = [], w = 1440, h = 900, touchEvents = false } = {}) {
  const e = {
    navigator: { userAgent: ua, maxTouchPoints: points },
    matchMedia: (q) => ({ matches: media.includes(q) }),
    screen: { width: w, height: h },
    innerWidth: w,
    innerHeight: h,
  };
  if (touchEvents) e.ontouchstart = null;
  return e;
}

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  androidTab: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

test('an iPhone is a touch phone', () => {
  const d = detectDevice(env({ ua: UA.iphone, points: 5, media: ['(pointer: coarse)'], w: 390, h: 844, touchEvents: true }));
  assert.equal(d.touch, true);
  assert.equal(d.kind, 'mobile');
});

test('an iPad reporting itself as a Mac (iPadOS Safari) is a touch tablet', () => {
  const d = detectDevice(env({ ua: UA.mac, points: 5, media: ['(pointer: coarse)', '(any-pointer: coarse)'], w: 1024, h: 1366, touchEvents: true }));
  assert.equal(d.touch, true);
  assert.equal(d.kind, 'tablet');
  assert.equal(d.reason, 'ipad-as-mac');
});

test('an iPad with a trackpad attached still counts as touch (it is an iPad)', () => {
  const d = detectDevice(env({ ua: UA.mac, points: 5, media: ['(pointer: fine)', '(any-pointer: fine)', '(hover: hover)'], w: 1180, h: 820 }));
  assert.equal(d.touch, true);
});

test('an older iPad user agent is a touch tablet', () => {
  assert.equal(detectDevice(env({ ua: UA.ipadOld, points: 5, w: 768, h: 1024 })).kind, 'tablet');
});

test('a real Mac (no touch points) is a desktop', () => {
  const d = detectDevice(env({ ua: UA.mac, points: 0, media: ['(pointer: fine)', '(any-pointer: fine)', '(hover: hover)'] }));
  assert.equal(d.touch, false);
  assert.equal(d.kind, 'desktop');
});

test('Android phone and tablet are touch', () => {
  assert.equal(detectDevice(env({ ua: UA.androidPhone, points: 5, media: ['(pointer: coarse)'], w: 412, h: 915 })).kind, 'mobile');
  assert.equal(detectDevice(env({ ua: UA.androidTab, points: 10, media: ['(pointer: coarse)'], w: 1600, h: 2560 })).kind, 'tablet');
});

test('a touch-screen Windows laptop (mouse/trackpad primary) is a desktop', () => {
  const d = detectDevice(env({ ua: UA.windows, points: 10, media: ['(pointer: fine)', '(any-pointer: fine)', '(any-pointer: coarse)', '(hover: hover)'], touchEvents: true }));
  assert.equal(d.touch, false);
});

test('a touch-only device with no mouse anywhere is touch (e.g. a Chromebook tablet)', () => {
  const d = detectDevice(env({ ua: UA.cros, points: 10, media: ['(any-pointer: coarse)'], w: 1280, h: 800, touchEvents: true }));
  assert.equal(d.touch, true);
});

test('a plain desktop is a desktop', () => {
  assert.equal(detectDevice(env({ ua: UA.windows, media: ['(pointer: fine)', '(any-pointer: fine)', '(hover: hover)'] })).touch, false);
});

test('a broken environment never throws', () => {
  assert.doesNotThrow(() => detectDevice({}));
  assert.equal(detectDevice({ matchMedia: () => { throw new Error('no'); } }).touch, false);
});
