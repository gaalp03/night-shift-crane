#!/usr/bin/env python3
"""
Builds assets/audio/ from the raw third-party recordings listed in CREDITS.md.

    python3 tools/make_audio.py <raw_dir> [out_dir]

Nothing here synthesises sound: every output is cut, layered, faded, level-matched or
re-pitched from a downloaded recording. <raw_dir> holds shallow clones / raw downloads of
the source packs (see the SRC table below for the expected sub-folders).
"""
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
RAW = sys.argv[1] if len(sys.argv) > 1 else "raw"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "assets", "audio")

SRC = {
    "impact": "Boyquotes_kenney-impact-sounds-for-godot/addons/kenney impact sounds",
    "rpg": "Boyquotes_kenney-rpg-audio-for-godot/addons/kenney rpg audio",
    "digital": "Boyquotes_kenney-digital-audio-for-godot/addons/kenney digital audio",
    "scifi": "Boyquotes_kenney-sci-fi-sounds-for-godot/addons/kenney sci-fi sounds",
    "iface": "Calinou_kenney-interface-sounds/addons/kenney_interface_sounds",
    "uiaudio": "Calinou_kenney-ui-audio/addons/kenney_ui_audio",
    "jingle": "ismetcabbar9-oss_kenney-audio-assets/Audio (295 files)/Jingle sounds (85 sounds)",
    "oc": "oculus",
    "wyz": "wyz",
    "fs": "fs",
    "music": "music_cand",
}


def path(pack, name):
    return os.path.join(RAW, SRC[pack], name)


def load(pack, name, mono=True, sr=SR):
    f = path(pack, name)
    if not os.path.exists(f):
        raise FileNotFoundError(f)
    ch = 1 if mono else 2
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"], capture_output=True)
    x = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
    if not mono:
        x = x.reshape(-1, 2)
    return x


def db(v):
    return 10 ** (v / 20.0)


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12)


def peak_norm(x, target_db=-1.5):
    p = np.max(np.abs(x)) + 1e-12
    return x * (db(target_db) / p)


def rms_norm(x, target_db, ceiling_db=-1.0):
    y = x * db(target_db - rms_db(x))
    p = np.max(np.abs(y))
    if p > db(ceiling_db):
        # soft clip the rare peaks instead of pulling the whole bed down
        lim = db(ceiling_db)
        y = np.tanh(y / lim) * lim
    return y


def seg(x, start, dur=None, sr=SR):
    a = int(start * sr)
    b = len(x) if dur is None else min(len(x), a + int(dur * sr))
    return x[a:b].copy()


def fade(x, fin=0.0, fout=0.0, sr=SR):
    y = x.copy()
    n = len(y)
    a = min(n, int(fin * sr))
    b = min(n, int(fout * sr))
    if a > 1:
        ramp = np.linspace(0, 1, a) ** 1.5
        y[:a] = y[:a] * (ramp[:, None] if y.ndim == 2 else ramp)
    if b > 1:
        ramp = np.linspace(1, 0, b) ** 1.5
        y[n - b:] = y[n - b:] * (ramp[:, None] if y.ndim == 2 else ramp)
    return y


def trim_head(x, thresh_db=-42, sr=SR, pre=0.004):
    """Remove leading silence so one-shots fire in sync with what you see."""
    m = np.abs(x if x.ndim == 1 else x.mean(axis=1))
    idx = np.argmax(m > db(thresh_db) * (np.max(m) + 1e-12))
    start = max(0, idx - int(pre * sr))
    return x[start:]


def trim_tail(x, thresh_db=-50, sr=SR, post=0.03):
    m = np.abs(x if x.ndim == 1 else x.mean(axis=1))
    above = np.nonzero(m > db(thresh_db) * (np.max(m) + 1e-12))[0]
    if len(above) == 0:
        return x
    end = min(len(x), above[-1] + int(post * sr))
    return x[:end]


def repitch(x, ratio):
    """Tape-style speed change (ratio < 1 = lower and longer)."""
    n = int(len(x) / ratio)
    idx = np.arange(n) * ratio
    if x.ndim == 1:
        return np.interp(idx, np.arange(len(x)), x)
    return np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1)


def lowpass(x, cutoff, sr=SR, order=2):
    """FFT brick-ish low-pass with a smooth knee (offline, so no need for anything fancier)."""
    def one(v):
        S = np.fft.rfft(v)
        f = np.fft.rfftfreq(len(v), 1 / sr)
        g = 1.0 / np.sqrt(1.0 + (f / cutoff) ** (2 * order))
        return np.fft.irfft(S * g, n=len(v))
    if x.ndim == 1:
        return one(x)
    return np.stack([one(x[:, c]) for c in range(x.shape[1])], axis=1)


def highpass(x, cutoff, sr=SR, order=2):
    def one(v):
        S = np.fft.rfft(v)
        f = np.fft.rfftfreq(len(v), 1 / sr)
        g = 1.0 - 1.0 / np.sqrt(1.0 + (f / cutoff) ** (2 * order))
        return np.fft.irfft(S * g, n=len(v))
    if x.ndim == 1:
        return one(x)
    return np.stack([one(x[:, c]) for c in range(x.shape[1])], axis=1)


def mix(*layers):
    n = max(len(l) for l in layers)
    out = np.zeros(n) if layers[0].ndim == 1 else np.zeros((n, layers[0].shape[1]))
    for l in layers:
        out[: len(l)] += l
    return out


def delay(x, seconds, sr=SR):
    pad = np.zeros(int(seconds * sr)) if x.ndim == 1 else np.zeros((int(seconds * sr), x.shape[1]))
    return np.concatenate([pad, x])


def loudest_window(x, dur, sr=SR, hop=0.1):
    """Start time of the loudest `dur`-second stretch (to find a breaking wave, a thunder roll…)."""
    m = x if x.ndim == 1 else x.mean(axis=1)
    w = int(dur * sr)
    h = int(hop * sr)
    best, best_t = -1, 0
    c = np.concatenate([[0], np.cumsum(np.square(m))])
    for a in range(0, len(m) - w, h):
        e = c[a + w] - c[a]
        if e > best:
            best, best_t = e, a
    return best_t / sr


def make_loop(x, xfade, sr=SR):
    """Equal-power crossfade of the tail into the head => sample-exact seamless loop."""
    n = int(xfade * sr)
    body = x[: len(x) - n].copy()
    tail = x[len(x) - n:]
    t = np.linspace(0, 1, n)
    fi = np.sin(t * np.pi / 2)
    fo = np.cos(t * np.pi / 2)
    if x.ndim == 2:
        fi, fo = fi[:, None], fo[:, None]
    body[:n] = body[:n] * fi + tail * fo
    return body


def write_wav(name, x, sr):
    os.makedirs(OUT, exist_ok=True)
    y = np.clip(x, -1, 1)
    data = (y * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1 if y.ndim == 1 else 2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())


def write_mp3(name, x, q=5, sr=SR):
    os.makedirs(OUT, exist_ok=True)
    ch = 1 if x.ndim == 1 else 2
    y = np.clip(x, -1, 1).astype("<f4")
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
         "-codec:a", "libmp3lame", "-q:a", str(q), "-map_metadata", "-1", os.path.join(OUT, name)],
        input=y.tobytes(), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode())


def resample(x, sr_from, sr_to):
    n = int(len(x) * sr_to / sr_from)
    idx = np.arange(n) * (sr_from / sr_to)
    return np.interp(idx, np.arange(len(x)), x)


done = []


def shot(name, x, peak=-1.5, fout=0.03, q=5, keep_head=False):
    """Standard one-shot: trim, fade the tail, peak-normalise, mono mp3."""
    if not keep_head:
        x = trim_head(x)
    x = trim_tail(x)
    x = fade(x, 0.002, fout)
    write_mp3(name + ".mp3", peak_norm(x, peak), q)
    done.append((name + ".mp3", len(x) / SR))


def bed(name, pack, src, start, dur, level, xf_pad=1.4, lp=None, hp=None, q=6):
    """Stereo ambience segment; the engine crossfades it into itself at runtime."""
    x = load(pack, src, mono=False)
    x = seg(x, start, dur + xf_pad)
    if lp:
        x = lowpass(x, lp)
    if hp:
        x = highpass(x, hp)
    x = fade(x, 0.02, 0.02)
    write_mp3(name + ".mp3", rms_norm(x, level), q)
    done.append((name + ".mp3", len(x) / SR))


def motor(name, pack, src, start, dur, level, lp=None, hp=None, ratio=1.0, sr=22050):
    """Short mono WAV loop with a baked crossfade: gapless under native looping + pitch bends."""
    x = load(pack, src, mono=True)
    x = seg(x, start, dur + 0.6)
    if ratio != 1.0:
        x = repitch(x, ratio)
    if lp:
        x = lowpass(x, lp)
    if hp:
        x = highpass(x, hp)
    x = make_loop(x, 0.5)
    x = rms_norm(x, level, -2.0)
    write_wav(name + ".wav", resample(x, SR, sr), sr)
    done.append((name + ".wav", len(x) / SR))


def music(name, src, start, dur, fin=0.05, fout=5.0, lufs=-18.5, bitrate="96k"):
    f = path("music", src)
    af = f"afade=t=in:st=0:d={fin},afade=t=out:st={dur - fout}:d={fout},loudnorm=I={lufs}:TP=-1.5:LRA=11,lowpass=f=15500"
    os.makedirs(OUT, exist_ok=True)
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(dur), "-i", f, "-af", af, "-ar", "44100", "-ac", "2",
         "-codec:a", "libmp3lame", "-b:a", bitrate, "-map_metadata", "-1", os.path.join(OUT, name + ".mp3")],
        capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode())
    done.append((name + ".mp3", dur))


def build():
    # ------------------------------------------------------------------ interface
    shot("ui_click", load("iface", "click_002.wav"))
    shot("ui_hover", load("uiaudio", "rollover2.wav"), peak=-6)
    shot("ui_tick", load("iface", "tick_001.wav"), peak=-4)
    shot("ui_back", load("oc", "UIClick_MetalBack_OS_01.ogg"))
    shot("ui_open", load("oc", "UIClick_MetalOpen_OS_01.ogg"))
    shot("ui_close", load("oc", "UIClick_MetalClose_OS_01.ogg"))
    shot("ui_confirm", load("oc", "UIClick_MetalConfirm_OS_01.ogg"))
    shot("ui_error", load("oc", "UIAlert_MetalError_OS_01.ogg"))
    shot("ui_toggle", load("oc", "MECHSwtch_SwitchSmallOn_OS_01.ogg"))
    shot("ui_toast", load("oc", "UIAlert_Notification_OS_05.ogg"), peak=-4)
    shot("ui_warn", load("oc", "UIAlert_Notification_OS_03.ogg"))
    shot("ui_buy", load("oc", "UIMisc_Powerup_OS_02.ogg"))
    shot("ui_star", seg(trim_head(load("oc", "UIAlert_MusicTone_OS_02.ogg")), 0, 1.7), fout=0.6)
    shot("ui_stamp", mix(load("impact", "impact_punch_heavy_001.ogg"), 0.6 * load("impact", "impact_wood_heavy_002.ogg")))
    shot("ui_coin", load("oc", "OBJCoin_CoinDrop_OS_01.ogg"))
    shot("ui_cash", seg(trim_head(load("oc", "OBJCoin_CoinsUI_LOOP_01.ogg")), 0, 1.5), fout=0.35)
    shot("ui_count", load("oc", "UIData_CasualCountup_OS_01.ogg"))
    for i, n in enumerate(["01", "02", "03"]):
        shot(f"whoosh_ui_{i + 1}", load("oc", f"SWSH_Swoosh_OS_{n}.ogg"))
    shot("door_close", load("oc", "DOORMetl_HatchClose_OS_01.ogg"), fout=0.3)
    shot("door_open", load("oc", "DOORMetl_HatchOpen_OS_01.ogg"), fout=0.3)

    # ------------------------------------------------------------------ results / feedback
    shot("perfect", seg(trim_head(load("oc", "UIMisc_BelltreeUp_OS_01.ogg")), 0.0, 1.9), fout=0.8)
    shot("great", load("oc", "UIAlert_Notification_OS_02.ogg"))
    shot("good", load("iface", "confirmation_001.wav"))
    shot("strike", mix(seg(trim_head(load("oc", "UIMisc_BelltreeDown_OS_01.ogg")), 0.0, 1.8), 0.5 * seg(load("oc", "DSGNImpt_ImpactCreepyReverb_OS_02.ogg"), 0, 1.8)), fout=0.7)
    shot("sting_win", load("oc", "MUSCStngr_VictoryPiano_OS_01.ogg"), fout=0.4)
    shot("sting_win3", load("oc", "MUSCStngr_VictoryOrchestral_OS_01.ogg"), fout=0.4)
    shot("sting_fail", load("oc", "MUSCStngr_LossPiano_OS_01.ogg"), fout=0.5)
    shot("sting_levelup", load("oc", "MUSCStngr_LevelUpMallet_OS_01.ogg"), fout=0.4)
    shot("sax_start", load("jingle", "jingles_SAX/jingles_SAX10.ogg"), fout=0.3)
    shot("sax_combo", load("jingle", "jingles_SAX/jingles_SAX03.ogg"), fout=0.3)
    shot("tick_alarm", load("iface", "tick_002.wav"), peak=-3)

    # ------------------------------------------------------------------ crane mechanics
    motor("motor_trolley", "oc", "MACHMisc_MachineHum_LOOP_02.ogg", 6.0, 3.6, -20, lp=6500)
    motor("motor_hoist", "oc", "MACHMisc_MachineGeneric_LOOP_02.ogg", 9.0, 3.6, -20, lp=7000)
    motor("motor_gantry", "oc", "VEHCar_CarEngineSlow_LOOP_01.ogg", 0.4, 3.0, -20, lp=3200, ratio=0.72)
    motor("truck_idle", "oc", "VEHCar_CarEngineSlow_LOOP_01.ogg", 0.5, 3.0, -21, lp=5200)
    motor("cab_hum", "oc", "AMBInd_RoomToneMachineRoom_LOOP_01.ogg", 12.0, 5.0, -26, lp=4200)
    shot("beep", seg(trim_head(load("digital", "tone_1.ogg")), 0, 0.32), peak=-6, fout=0.06)
    shot("hydraulic", seg(trim_head(load("oc", "MACHInd_Hydraulic_OS_01.ogg")), 0, 1.3), fout=0.45)
    shot("servo", seg(trim_head(load("oc", "MOTRSrvo_Servo_OS_01.ogg")), 0.2, 1.2), fout=0.3)
    lever = trim_head(load("oc", "MECHLvr_LeverPull_OS_01.ogg"))
    latch = trim_head(load("rpg", "metal_latch.ogg"))
    clunk = repitch(trim_head(load("impact", "impact_metal_medium_002.ogg")), 0.62)
    shot("lock", mix(lever, delay(0.9 * latch, 0.05), delay(0.55 * peak_norm(clunk), 0.09)), fout=0.2)
    shot("unlock", mix(trim_head(load("oc", "MECHLvr_LeverPull_OS_03.ogg")), 0.5 * trim_head(load("rpg", "metal_click.ogg"))))
    shot("chain", seg(trim_head(load("oc", "CHAINMvmt_ChainsCreepy_OS_02.ogg")), 0.1, 1.3), fout=0.4)
    shot("air_brake", repitch(seg(trim_head(load("oc", "MACHInd_Hydraulic_OS_01.ogg")), 1.2, 1.4), 1.5), fout=0.4, peak=-5)

    # ------------------------------------------------------------------ steel on steel
    # containers are big resonant boxes: Kenney's metal hits, slowed down for mass
    for i in range(4):
        hit = trim_head(load("impact", f"impact_metal_heavy_00{i}.ogg"))
        plate = trim_head(load("impact", f"impact_plate_heavy_00{i}.ogg"))
        shot(f"impact_heavy_{i + 1}", mix(repitch(hit, 0.56), 0.7 * repitch(plate, 0.5)), fout=0.25)
    shot("impact_heavy_5", mix(repitch(trim_head(load("oc", "METLImpt_MetalHitSurface_OS_03.ogg")), 0.6), 0.5 * repitch(trim_head(load("impact", "impact_plate_heavy_004.ogg")), 0.5)), fout=0.3)
    for i in range(4):
        shot(f"impact_med_{i + 1}", repitch(trim_head(load("impact", f"impact_metal_medium_00{i}.ogg")), 0.7), fout=0.15)
    for i in range(3):
        shot(f"impact_light_{i + 1}", repitch(trim_head(load("impact", f"impact_metal_light_00{i}.ogg")), 0.82), fout=0.1)
    for i in range(3):
        shot(f"impact_deck_{i + 1}", mix(repitch(trim_head(load("impact", f"impact_plate_medium_00{i}.ogg")), 0.55), 0.5 * repitch(trim_head(load("impact", f"impact_wood_heavy_00{i}.ogg")), 0.6)), fout=0.2)
    shot("boom_1", mix(load("oc", "DSGNImpt_ImpactCreepyReverb_OS_03.ogg"), 0.8 * repitch(trim_head(load("wyz", "cinematic-metal-big.wav")), 0.8)), fout=0.9)
    shot("boom_2", mix(load("oc", "DSGNImpt_ImpactCreepyReverb_OS_01.ogg"), 0.8 * repitch(trim_head(load("wyz", "cinematic-slam-big.wav")), 0.85)), fout=0.9)
    shot("scrape_1", repitch(load("oc", "METLFric_ScratchCreepy_OS_01.ogg"), 0.7), fout=0.3)
    shot("scrape_2", repitch(load("oc", "METLFric_ScratchCreepy_OS_02.ogg"), 0.7), fout=0.3)
    shot("creak_1", repitch(load("oc", "WOODFric_CreaksCreepy_OS_01.ogg"), 0.75), fout=0.5, peak=-4)
    shot("creak_2", repitch(trim_head(load("rpg", "creak_1.ogg")), 0.6), fout=0.3, peak=-4)
    shot("creak_3", repitch(trim_head(load("rpg", "creak_3.ogg")), 0.6), fout=0.3, peak=-4)
    for i in range(3):
        shot(f"glass_{i + 1}", load("impact", f"impact_glass_heavy_00{i}.ogg"))
    shot("explosion", mix(peak_norm(load("scifi", "explosion_crunch_000.ogg")), 0.9 * peak_norm(load("scifi", "low_frequency_explosion_000.ogg")), 0.6 * seg(load("fs", "misc_cineboom.flac"), 0, 3.0)), fout=1.2)
    for i, n in enumerate(["01", "02", "03"]):
        shot(f"whoosh_{i + 1}", repitch(load("oc", f"WHSH_WhooshMedium_OS_{n}.ogg"), 0.6))

    # ------------------------------------------------------------------ water
    waves = load("oc", "WATRWave_OceanWaves_LOOP_01.ogg")
    t0 = loudest_window(waves, 2.6)
    crash = fade(seg(waves, max(0, t0 - 0.05), 3.2), 0.03, 1.6)
    plop = trim_head(load("wyz", "props-splash.wav"))
    thump = lowpass(seg(load("fs", "misc_cineboom.flac"), 0, 1.6), 220)
    swash = trim_head(load("fs", "perc_swash.flac"))
    shot("splash_big", mix(1.0 * peak_norm(crash), 0.75 * peak_norm(repitch(plop, 0.55)), 0.7 * peak_norm(thump), 0.35 * peak_norm(repitch(swash, 0.6))), fout=1.2)
    shot("splash_small", mix(peak_norm(repitch(plop, 0.8)), 0.5 * peak_norm(repitch(swash, 0.9))), fout=0.3)
    bub = load("oc", "WATRBubl_WaterBubbles_LOOP_01.ogg")
    shot("bubbles", fade(seg(bub, loudest_window(bub, 2.4), 2.6), 0.15, 1.2), fout=0.6, keep_head=True)
    bed("sea_loop", "oc", "WATRLap_WaterLapping_LOOP_01.ogg", 4.0, 20.0, -25)
    bed("waves_loop", "oc", "WATRWave_OceanWaves_LOOP_01.ogg", 8.0, 20.0, -24)

    # ------------------------------------------------------------------ weather
    bed("rain_loop", "oc", "RAIN_CityRain_LOOP_01.ogg", 5.0, 20.0, -25)
    bed("rain_cab_loop", "oc", "RAINInt_ForestCabinRain_LOOP_01.ogg", 5.0, 14.0, -26)
    bed("wind_loop", "fs", "502774__bolkmar__windy-landscape-beach-trees-wind.wav", 4.0, 20.0, -25, hp=70)
    shot("gust_1", load("fs", "ambi_swoosh.flac"), fout=0.6, keep_head=True)
    shot("gust_2", repitch(load("fs", "ambi_dark_woosh.flac"), 1.2), fout=0.9, keep_head=True)
    shot("thunder_1", repitch(load("wyz", "cinematic-thunder-big.wav"), 0.85), fout=1.5)
    shot("thunder_2", repitch(load("wyz", "cinematic-thunder-massive.wav"), 0.8), fout=1.8)

    # ------------------------------------------------------------------ harbour life
    horn = load("fs", "343062__maico201__french-horn-built-up.wav")
    chord = fade(seg(horn, 1.42, 2.1), 0.05, 0.5)
    shot("horn_ship", lowpass(repitch(chord, 0.4), 2200), fout=0.8, keep_head=True, peak=-2)
    shot("horn_crane", lowpass(fade(repitch(seg(horn, 4.0, 0.62), 0.74), 0.02, 0.2), 3600), fout=0.15, keep_head=True, peak=-3)
    shot("horn_truck", fade(repitch(seg(horn, 6.0, 0.42), 1.05), 0.01, 0.12), fout=0.1, keep_head=True, peak=-4)
    shot("crow", load("fs", "misc_crow.flac"), peak=-5)
    shot("bell_buoy", repitch(trim_head(load("impact", "impact_bell_heavy_002.ogg")), 0.7), fout=0.8, peak=-6)
    shot("vox_hey", load("oc", "VOXEfrt_Male01Effort_OS_01.ogg"), peak=-5)
    shot("vox_laugh", load("oc", "VOXLaff_Male01Laugh_OS_01.ogg"), peak=-5)
    shot("vox_yell", load("oc", "VOXScrm_MaleScream_OS_01.ogg"), peak=-6)
    shot("car_door", load("oc", "VEHDoor_CarDoorClose_OS_01.ogg"), peak=-5)

    # ------------------------------------------------------------------ music (CC0)
    music("music_menu", "fpd__3 am West End.mp3", 0, 188)
    music("music_shift_a", "hol__Night Life.mp3", 0, 206)
    music("music_shift_b", "hol__City Lights.mp3", 0, 204)
    music("music_shift_c", "fpd__Limit 70.mp3", 0, 200)
    music("music_storm", "fpd__Bass Meant Jazz.mp3", 0, 196)


if __name__ == "__main__":
    build()
    total = 0
    for name, dur in done:
        size = os.path.getsize(os.path.join(OUT, name))
        total += size
        print(f"{name:28s} {dur:7.2f}s {size / 1024:8.1f} KB")
    print(f"{len(done)} files, {total / 1024 / 1024:.2f} MB")
