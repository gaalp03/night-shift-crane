// What the player is holding: a touch device (phone / tablet, iPads that report themselves as a Mac
// included) or a desktop (keyboard + mouse, touch-screen laptops included). Decides the controls
// at launch; the CrazyGames SDK's own device type, when present, still wins (see main.js).

/**
 * @param env  the global object to inspect (window in the browser; a fake in tests)
 * @returns { touch, kind: 'mobile' | 'tablet' | 'desktop', reason }
 */
export function detectDevice(env = globalThis) {
  const nav = env.navigator || {};
  const ua = nav.userAgent || '';
  const points = nav.maxTouchPoints || 0;
  const mq = (q) => {
    try {
      return !!(env.matchMedia && env.matchMedia(q).matches);
    } catch (e) {
      return false;
    }
  };
  const scr = env.screen || {};
  const short = Math.min(scr.width || env.innerWidth || 0, scr.height || env.innerHeight || 0);
  // iPadOS 13+ Safari says "Macintosh"; a real Mac has no touch points
  const iPadAsMac = /Macintosh/.test(ua) && points > 1;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile/i.test(ua);
  const coarse = mq('(pointer: coarse)');
  const anyFine = mq('(any-pointer: fine)');
  const hover = mq('(hover: hover)');
  const touchEvents = 'ontouchstart' in env || points > 0;
  let touch = false;
  let reason = 'desktop';
  if (iPadAsMac) {
    touch = true;
    reason = 'ipad-as-mac';
  } else if (mobileUA) {
    touch = true;
    reason = 'mobile-ua';
  } else if (coarse && !hover) {
    // the primary pointer is a finger (a touch-screen laptop has a fine, hovering primary pointer)
    touch = true;
    reason = 'coarse-pointer';
  } else if (touchEvents && !anyFine) {
    // touch input and no mouse / trackpad anywhere
    touch = true;
    reason = 'touch-only';
  }
  const tablet = touch && (iPadAsMac || /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || short >= 600);
  return { touch, kind: touch ? (tablet ? 'tablet' : 'mobile') : 'desktop', reason };
}
