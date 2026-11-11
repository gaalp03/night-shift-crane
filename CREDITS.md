# Night Shift Crane — Credits

Game design, code, 3D models, textures, shaders and UI: built for this project (all models and
textures are generated procedurally in code, no third-party art assets).

Every sound in the game is a real downloaded recording. Nothing is synthesised at runtime; the
files in `assets/audio/` were cut, layered, re-pitched and level-matched from the sources below
by `tools/make_audio.py`.

## Sound effects

### Kenney — CC0 1.0 (public domain) — https://kenney.nl
Packs: **Impact Sounds**, **RPG Audio**, **Interface Sounds**, **UI Audio**, **Digital Audio**,
**Sci-Fi Sounds**, **Music Jingles**.
Used for: container impacts (`impact_*`, `glass_*`), twist-lock latch layers (`lock`, `unlock`),
ship creaks (`creak_2`, `creak_3`), UI clicks/ticks (`ui_click`, `ui_hover`, `ui_tick`,
`tick_alarm`, `good`, `ui_stamp`), travel alarm (`beep`), hazmat blast layers (`explosion`),
buoy bell (`bell_buoy`), saxophone stings (`sax_start`, `sax_combo`).

### Oculus Audio Pack 01 — CC BY 4.0
"Oculus Audio Pack 01" by Oculus VR, LLC
(https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under
CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Files renamed to the UCS naming
convention; OGG previews transcoded from the original WAVs (distributed via
https://github.com/facebookincubator/Meta-open-sound).
**Changes made for this game:** trimmed, faded, re-pitched, layered with other sources and
transcoded to MP3 / WAV.
Used for: crane motors (`motor_*`, `cab_hum`), truck engine (`truck_idle`), hydraulics and servo
(`hydraulic`, `servo`, `air_brake`), lever/latch layers (`lock`, `unlock`), cable rattle
(`chain`), heavy impacts and booms (`impact_heavy_5`, `boom_*`), scrapes and creaks (`scrape_*`,
`creak_1`), whooshes (`whoosh_*`, `whoosh_ui_*`), rain, sea and wave ambiences (`rain_loop`,
`rain_cab_loop`, `sea_loop`, `waves_loop`), splash and bubbles (`splash_big`, `bubbles`),
metal UI set (`ui_back`, `ui_open`, `ui_close`, `ui_confirm`, `ui_error`, `ui_toggle`,
`ui_toast`, `ui_warn`, `ui_buy`, `ui_star`, `ui_coin`, `ui_cash`, `ui_count`), transition doors
(`door_open`, `door_close`), result stings (`sting_*`, `perfect`, `great`, `strike`), dock-worker
voices (`vox_*`), `car_door`.

### Wyzowl SFX Kit — CC0 1.0 — https://github.com/wyzowl/sfx-kit
Used for: thunder (`thunder_1`, `thunder_2`), water plop layer (`splash_big`, `splash_small`),
boom layers (`boom_1`, `boom_2`).

### Freesound.org — CC0 1.0 samples
- "French Horn Built Up" by maico201 (freesound #343062) — ship, crane and truck horns
  (`horn_ship`, `horn_crane`, `horn_truck`), pitched down.
- "Windy Landscape Beach Trees Wind" by bolkmar (freesound #502774) — `wind_loop`.
- From the CC0 sample set bundled with Sonic Pi (https://github.com/sonic-pi-net/sonic-pi):
  `misc_cineboom` by Northern_Monkey (#177242), `perc_swash` by qubodup (#60009),
  `ambi_swoosh` by Halgrimm (#169867), `ambi_dark_woosh` by EcoDTR (#27281),
  `misc_crow` by davidworksonline (#54973) — splash/explosion layers, wind gusts, crow.

## Music — all CC0 1.0 (public domain)

| In game | Track | Artist | Source |
| --- | --- | --- | --- |
| Menu / workshop | "3 am West End" | Statusq | FreePD.com |
| Shift playlist | "Night Life" | HoliznaCC0 | Free Music Archive |
| Shift playlist | "City Lights" | HoliznaCC0 | Free Music Archive |
| Shift playlist | "Limit 70" | Kevin MacLeod | FreePD.com |
| Storm / Overtime | "Bass Meant Jazz" | Kevin MacLeod | FreePD.com |

Music files were obtained through the SoundSafari CC0-1.0-Music corpus
(https://github.com/SoundSafari/CC0-1.0-Music), trimmed, loudness-normalised and re-encoded.

## Fonts — SIL Open Font License 1.1

- **Bungee** by David Jonathan Ross
- **Barlow Condensed** by Jeremy Tribby
- **Saira Stencil One** by Omnibus-Type

## Libraries

- **three.js** — MIT License — https://threejs.org
- **Rapier** physics engine by Dimforge — Apache License 2.0 — https://rapier.rs

Both are bundled into `build/game.js` (no CDN).

## Platform

CrazyGames HTML5 SDK v3 is loaded from CrazyGames' servers when the game runs on their
platform; the game works without it everywhere else.
