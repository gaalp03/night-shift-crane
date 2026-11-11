// CrazyGames HTML5 SDK v3 wrapper. Every call is a safe no-op when the SDK is missing
// (GitHub Pages, local file, ad blockers) so the game never depends on it.

const state = {
  sdk: null,
  ready: false,
  env: 'none', // 'crazygames' | 'local' | 'disabled' | 'none'
  playing: false,
  loading: false,
  adActive: false,
  lastMidgame: 0,
  listeners: new Set(),
};

function call(fn) {
  try {
    return fn();
  } catch (e) {
    return undefined;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((res) => setTimeout(() => res('timeout'), ms))]);
}

export const sdk = {
  get available() {
    return state.ready && (state.env === 'crazygames' || state.env === 'local');
  },
  get environment() {
    return state.env;
  },
  get adActive() {
    return state.adActive;
  },

  /** Resolves quickly even if the script is blocked or we are not on CrazyGames. */
  async init() {
    const cg = window.CrazyGames && window.CrazyGames.SDK;
    if (!cg) return false;
    try {
      const r = await withTimeout(cg.init(), 4000);
      if (r === 'timeout') return false;
      state.sdk = cg;
      state.env = cg.environment || 'local';
      state.ready = state.env !== 'disabled';
      if (state.ready) {
        call(() =>
          cg.game.addSettingsChangeListener((s) => {
            for (const fn of state.listeners) fn(s);
          })
        );
      }
    } catch (e) {
      state.ready = false;
    }
    return state.ready;
  },

  /** Platform-driven settings (e.g. muteAudio). */
  settings() {
    return (state.ready && call(() => state.sdk.game.settings)) || {};
  },
  onSettings(fn) {
    state.listeners.add(fn);
  },

  loadingStart() {
    if (!state.ready || state.loading) return;
    state.loading = true;
    call(() => state.sdk.game.loadingStart());
  },
  loadingStop() {
    if (!state.ready || !state.loading) return;
    state.loading = false;
    call(() => state.sdk.game.loadingStop());
  },
  gameplayStart() {
    if (state.playing) return;
    state.playing = true;
    if (state.ready) call(() => state.sdk.game.gameplayStart());
  },
  gameplayStop() {
    if (!state.playing) return;
    state.playing = false;
    if (state.ready) call(() => state.sdk.game.gameplayStop());
  },
  happytime() {
    if (state.ready) call(() => state.sdk.game.happytime());
  },

  /**
   * Shows an ad. Resolves { shown, rewarded, error }.
   * `hooks.pause()` / `hooks.resume()` are called around a real ad so the game can mute + freeze.
   */
  requestAd(type, hooks = {}) {
    return new Promise((resolve) => {
      if (!this.available || state.adActive) {
        resolve({ shown: false, rewarded: false, error: state.adActive ? 'busy' : 'unavailable' });
        return;
      }
      let settled = false;
      let started = false;
      const finish = (res) => {
        if (settled) return;
        settled = true;
        state.adActive = false;
        if (started && hooks.resume) call(hooks.resume);
        resolve(res);
      };
      state.adActive = true;
      // Safety net: never leave the game frozen if the SDK goes silent.
      const guard = setTimeout(() => finish({ shown: started, rewarded: false, error: 'timeout' }), 90000);
      try {
        state.sdk.ad.requestAd(type, {
          adStarted: () => {
            started = true;
            if (hooks.pause) call(hooks.pause);
          },
          adFinished: () => {
            clearTimeout(guard);
            if (type === 'midgame') state.lastMidgame = performance.now();
            finish({ shown: true, rewarded: true });
          },
          adError: (err) => {
            clearTimeout(guard);
            finish({ shown: false, rewarded: false, error: (err && (err.code || err.message)) || 'error' });
          },
        });
      } catch (e) {
        clearTimeout(guard);
        finish({ shown: false, rewarded: false, error: 'exception' });
      }
    });
  },

  /** Midgame ad between shifts; the SDK itself rate-limits, we add a soft guard too. */
  midgame(hooks) {
    if (!this.available) return Promise.resolve({ shown: false });
    if (performance.now() - state.lastMidgame < 60000 && state.lastMidgame > 0) return Promise.resolve({ shown: false });
    return this.requestAd('midgame', hooks);
  },

  rewarded(hooks) {
    return this.requestAd('rewarded', hooks);
  },
};
