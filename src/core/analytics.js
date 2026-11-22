// Funnel analytics: a tiny pluggable event hook. Nothing is sent anywhere unless a sink exists:
//   - ByteBrew web SDK (window.ByteBrew.NewCustomEvent) if the page loads it
//   - any function assigned to window.NSC_ANALYTICS(name, params)
//   - sinks added with analytics.addSink(fn)
// Events are also kept in a small ring buffer (analytics.log) for local inspection / QA.

const sinks = new Set();
const once = new Set();
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

function toByteBrew(params) {
  // ByteBrew custom event parameters: "key=value;key=value"
  return Object.keys(params)
    .map((k) => `${k}=${String(params[k]).replace(/[;=]/g, '_')}`)
    .join(';');
}

export const analytics = {
  log: [],

  addSink(fn) {
    sinks.add(fn);
  },

  /** Record an event. `params` should stay flat (strings / numbers). */
  track(name, params = {}) {
    const p = { ...params, t: Math.round((performance.now() - t0) / 100) / 10 };
    this.log.push({ name, p });
    if (this.log.length > 200) this.log.shift();
    try {
      const bb = window.ByteBrew;
      if (bb && typeof bb.NewCustomEvent === 'function') {
        const s = toByteBrew(params);
        if (s) bb.NewCustomEvent(name, s);
        else bb.NewCustomEvent(name);
      }
    } catch (e) {}
    try {
      if (typeof window.NSC_ANALYTICS === 'function') window.NSC_ANALYTICS(name, p);
    } catch (e) {}
    for (const fn of sinks) {
      try {
        fn(name, p);
      } catch (e) {}
    }
  },

  /** Same, but at most once per page session (funnel steps). */
  trackOnce(name, params) {
    if (once.has(name)) return;
    once.add(name);
    this.track(name, params);
  },
};

if (typeof window !== 'undefined') window.nscAnalytics = analytics;
