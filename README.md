# Night Shift Crane

A 3D harbour-crane stacking game for the browser. Run ship-to-shore crane 07 through the graveyard
shift: lift containers off the trucks, fight the swing, the wind and the swell, and twist-lock them
onto a rolling ship before it sails.

- **12 shifts** with escalating mechanics (destination bays, swell, gusts, heavy / fragile / reefer /
  hazmat cargo, fog, discharge orders, a full storm), 1–3 stars each
- **Overtime**: an endless high-score mode, ship after ship
- **Workshop** upgrades and crane paint jobs between shifts
- Real rigid-body physics: cable-suspended spreader, momentum, wind, a ship that heaves, rolls and
  lists with its load, stacks that can be knocked into the sea
- Third-person view and a top-down crane-cab view, desktop keyboard / gamepad and mobile touch controls

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
