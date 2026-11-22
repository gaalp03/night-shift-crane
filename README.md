# Night Shift Crane

![Night Shift Crane — carrying a heavy box over a rolling deck](docs/screenshot-play.jpg)

A 3D harbour-crane stacking game for the browser. Run ship-to-shore crane 07 through the graveyard
shift: lift containers off the trucks, fight the swing, the wind and the swell, and twist-lock them
onto a rolling ship before it sails.

- **Straight into the cab**: a first-time player loads in with a box already on the hook — the first
  thing they do is let go of it, and coins fly into the wallet. Each following box teaches one
  control in play (no cards, no tutorial chain, no tour)
- **The night shift** (main mode): endless, ship after ship. Each ship is a 60–90 second round of
  4–6 boxes and the next one comes alongside automatically. A dropped box costs its bonus and the
  combo, never the shift. Combo multiplier up to x3, every box pays straight into the wallet
- **Upgrades that change the play**: anti-sway damper, drive motors, magnet assist (auto-lock at
  level 2), wide spreader (longer flippers, more forgiving), hoist winch, overtime clause — bought
  mid-shift from the upgrade chip. The port visibly grows with everything you move
- **Reasons to come back**: one episode of the Pier Seven story a night (a black box, your choice,
  a cliffhanger), and your night crew's takings waiting when you return
- **One-touch mobile play**: drag the spreader where you want it; hoisting, lowering, locking and
  releasing happen by themselves. Works in portrait and landscape
- **Challenges**: 12 hand-made shifts (destination bays, gusts, customs spot checks, heavy / fragile /
  reefer / hazmat cargo, forty-footers, fog, power cuts, a full storm) and a generated daily shift
- Progress is saved locally and, for signed-in CrazyGames players, in the cloud
- Small first load: the physics WASM ships as a binary next to the script, sounds stream in after
  the game has started

![Title screen](docs/screenshot-title.jpg)

## Play

It is a static site: open `index.html` from any web server (GitHub Pages works as-is).

```bash
npm install
npm run serve      # http://localhost:8080
```

| Action | Keyboard | Touch |
| --- | --- | --- |
| Trolley (out / in) | `A` `D` or `←` `→` | stick left / right |
| Gantry (along the quay) | `W` `S` or `↑` `↓` | stick up / down |
| Hoist / lower | `E` / `Q` | ▲ / ▼ buttons |
| Lock on / release | `Space` | round button |
| Cab view | `C` | camera button |
| Horn | `H` | — |
| Pause | `Esc` | pause button |

## Develop

Source lives in `src/` (ES modules). `build/game.js` is the committed production bundle with
three.js and the Rapier physics engine included — nothing is loaded from a CDN.

```bash
npm run build      # src/ -> build/game.js
npm run watch      # rebuilds build/game.dev.js on change (with dev hooks + source maps)
```

`tools/make_audio.py` documents how every file in `assets/audio/` was cut from its source
recording. See [CREDITS.md](CREDITS.md) for all third-party audio, music, fonts and libraries.

## Platform

The game integrates the CrazyGames HTML5 SDK v3 (loading, gameplay start/stop, happytime, midgame
ads between shifts, rewarded "second chance"). Every SDK call is a safe no-op when the SDK is not
present, so the same build runs on GitHub Pages or locally. Progress is stored in `localStorage`.
