#!/usr/bin/env python3
"""Build the game's sound effects (run with /opt/venv/bin/python).

Sources: CC0 packs from OpenGameArt (RPG Sound Pack by artisticdude; 80 CC0 RPG SFX, 80 CC0 creature
SFX, 100 CC0 metal and wood SFX, 100 CC0 SFX, 75 CC0 breaking/falling/hit SFX, 25 CC0 bang SFX by
rubberduck; Forest Ambience) in /opt/raw/sfx. Missing sounds are synthesised here (whooshes,
footsteps, chimes, weather loops). Everything is trimmed, faded, loudness-normalised and written as
mono MP3 to public/assets/audio/sfx/<name>_<n>.mp3 with a manifest.
"""
import glob
import json
import os
import numpy as np
import soundfile as sf
import lameenc

SR = 44100
RAW = '/opt/raw/sfx'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'audio', 'sfx')
rng = np.random.default_rng(7)


def load(rel):
    paths = glob.glob(os.path.join(RAW, '**', rel), recursive=True)
    paths = [p for p in paths if '__MACOSX' not in p]
    if not paths:
        raise FileNotFoundError(rel)
    x, sr = sf.read(paths[0], dtype='float32', always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        n = int(len(x) * SR / sr)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def trim(x, thresh=0.01, pad=0.01):
    a = np.abs(x)
    idx = np.where(a > thresh * a.max())[0]
    if len(idx) == 0:
        return x
    s = max(0, idx[0] - int(pad * SR))
    e = min(len(x), idx[-1] + int(pad * 4 * SR))
    return x[s:e]


def fade(x, fi=0.003, fo=0.04):
    x = x.copy()
    a = min(len(x) // 2, int(fi * SR))
    b = min(len(x) // 2, int(fo * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def norm(x, peak=0.9, rms=None):
    x = x - x.mean()
    if rms:
        r = np.sqrt(np.mean(x ** 2)) + 1e-9
        x = x * (rms / r)
    m = np.abs(x).max() + 1e-9
    if m > peak or not rms:
        x = x * (peak / m)
    return x


def pitch(x, k):
    """resample pitch shift (k>1 higher)"""
    n = int(len(x) / k)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def lowpass(x, fc):
    # one-pole
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lp_fast(x, fc):
    # FFT brickwall-ish with soft roll-off (fast)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x)).astype(np.float32)


def hp_fast(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x)).astype(np.float32)


def bp_noise(dur, f0, f1, env):
    n = int(dur * SR)
    w = rng.standard_normal(n).astype(np.float32)
    X = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    X *= np.exp(-((np.log((f + 1) / ((f0 + f1) / 2))) ** 2) / (2 * (np.log(f1 / f0) / 2) ** 2))
    y = np.fft.irfft(X, n).astype(np.float32)
    return y * env(np.linspace(0, 1, n))


def mix(*parts):
    n = max(len(p) for p, _, _ in parts)
    y = np.zeros(n, np.float32)
    for p, gain, offset in parts:
        o = int(offset * SR)
        m = min(len(p), n - o)
        y[o:o + m] += p[:m] * gain
    return y


def reverb(x, size=0.6, wet=0.25):
    """cheap: sum of decaying, filtered noise impulse convolved via FFT"""
    n = int(size * SR)
    ir = rng.standard_normal(n).astype(np.float32) * np.exp(-np.linspace(0, 6, n)).astype(np.float32)
    ir = lp_fast(ir, 5000)
    ir /= np.abs(ir).sum() ** 0.5 * 4
    L = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L).astype(np.float32)
    out = np.zeros(L, np.float32)
    out[:len(x)] = x
    return out * (1 - wet) + y * wet


def write(name, i, x, kbps=112):
    os.makedirs(OUT, exist_ok=True)
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype(np.int16).tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    data = enc.encode(pcm) + enc.flush()
    with open(os.path.join(OUT, f'{name}_{i}.mp3'), 'wb') as f:
        f.write(data)


# ---------------------------------------------------------------- synthesis

def whoosh(dur=0.35, f0=350, f1=2200, tilt=0.0):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t ** 0.7) ** 2
    # sweep a band-pass through noise
    w = rng.standard_normal(n).astype(np.float32)
    y = np.zeros(n, np.float32)
    seg = 512
    for s in range(0, n, seg):
        k = s / n
        fc = f0 + (f1 - f0) * np.sin(np.pi * k)
        chunk = w[s:s + seg]
        y[s:s + seg] = hp_fast(lp_fast(chunk, fc * 1.6), fc * 0.4)[:len(chunk)]
    return norm(y * env.astype(np.float32), 0.8)


def footstep(kind):
    dur = 0.18
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    if kind == 'grass':
        y = bp_noise(dur, 1500, 7000, lambda t: np.exp(-t * 9) * (1 - np.exp(-t * 200)))
        y += bp_noise(dur, 80, 300, lambda t: np.exp(-t * 25)) * 0.6
    elif kind == 'stone':
        y = bp_noise(dur, 900, 5000, lambda t: np.exp(-t * 30)) * 0.9
        y += bp_noise(dur, 100, 400, lambda t: np.exp(-t * 35)) * 0.8
    elif kind == 'wood':
        y = bp_noise(dur, 300, 1400, lambda t: np.exp(-t * 22))
        y += np.sin(2 * np.pi * 180 * t * dur) * np.exp(-t * 30) * 0.5
    elif kind == 'snow':
        y = bp_noise(0.28, 600, 3500, lambda t: (1 - np.exp(-t * 30)) * np.exp(-t * 6)) * 1.2
        crunch = (rng.random(int(0.28 * SR)) < 0.02).astype(np.float32) * rng.standard_normal(int(0.28 * SR)).astype(np.float32)
        y += hp_fast(crunch, 2000) * 0.5
    elif kind == 'water':
        y = bp_noise(0.25, 300, 3000, lambda t: np.exp(-t * 7) * (1 - np.exp(-t * 60)))
    else:  # dirt
        y = bp_noise(dur, 200, 2500, lambda t: np.exp(-t * 18))
    return norm(y.astype(np.float32), 0.7)


def chime(base=880):
    dur = 1.6
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, (m, a) in enumerate(((1, 1), (2.76, 0.45), (5.4, 0.25), (1.5, 0.3))):
        y += a * np.sin(2 * np.pi * base * m * t + k) * np.exp(-t * (3 + k * 2))
    return norm(reverb(y.astype(np.float32), 1.2, 0.35), 0.6)


def loop_noise(dur, kind):
    n = int(dur * SR)
    if kind == 'rain':
        y = bp_noise(dur, 1500, 9000, lambda t: np.ones_like(t)) * 0.6
        drops = (rng.random(n) < 0.004).astype(np.float32) * rng.standard_normal(n).astype(np.float32)
        y += hp_fast(lp_fast(drops, 6000), 1200) * 1.5
        y += bp_noise(dur, 80, 400, lambda t: np.ones_like(t)) * 0.25
    elif kind == 'wind':
        w = bp_noise(dur, 150, 900, lambda t: np.ones_like(t))
        t = np.linspace(0, dur, n)
        gust = 0.55 + 0.45 * np.sin(2 * np.pi * t / dur * 3) * np.sin(2 * np.pi * t / dur * 1 + 1)
        y = w * gust
        y += bp_noise(dur, 1500, 4000, lambda t: np.ones_like(t)) * 0.12 * gust
    elif kind == 'fire':
        y = bp_noise(dur, 200, 1200, lambda t: np.ones_like(t)) * 0.5
        crk = (rng.random(n) < 0.0016).astype(np.float32) * rng.standard_normal(n).astype(np.float32)
        y += hp_fast(lp_fast(crk, 7000), 900) * 3
        y += bp_noise(dur, 40, 120, lambda t: np.ones_like(t)) * 0.4
    elif kind == 'lava':
        y = bp_noise(dur, 30, 160, lambda t: np.ones_like(t)) * 1.0
        bub = (rng.random(n) < 0.0006).astype(np.float32)
        y += lp_fast(np.convolve(bub, np.sin(np.linspace(0, 40, 2000)) * np.exp(-np.linspace(0, 6, 2000)), 'same').astype(np.float32), 400) * 0.8
    else:  # cave drone
        y = bp_noise(dur, 50, 300, lambda t: np.ones_like(t))
    # seamless loop: crossfade tail into head
    x = int(0.5 * SR)
    y = y.astype(np.float32)
    y[:x] = y[:x] * np.linspace(0, 1, x) + y[-x:] * np.linspace(1, 0, x)
    y = y[:-x]
    return norm(y, 0.7)


def heartbeat():
    dur = 1.0
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 50 * t) * np.exp(-((t - 0.05) / 0.03) ** 2) + 0.7 * np.sin(2 * np.pi * 45 * t) * np.exp(-((t - 0.3) / 0.035) ** 2)
    return norm(y.astype(np.float32), 0.8)


# ---------------------------------------------------------------- the list

def build():
    M = {}

    def put(name, variants, kbps=112):
        M[name] = len(variants)
        for i, v in enumerate(variants):
            write(name, i, fade(v), kbps)

    # blades
    swings = [load('swing.wav'), load('swing2.wav'), load('swing3.wav')]
    put('swing', [norm(trim(pitch(s, k)), 0.7) for s in swings for k in (1.0, 1.12)])
    put('heavy_swing', [norm(mix((pitch(trim(s), 0.8), 1, 0), (whoosh(0.5, 200, 900), 0.6, 0.0)), 0.8) for s in swings])
    put('whoosh', [whoosh(0.3 + 0.05 * i, 300 + 80 * i, 1800 + 300 * i) for i in range(4)])
    put('draw', [norm(trim(load(f'sword-unsheathe{n}.wav')), 0.75) for n in ('', '2', '3', '4', '5')])
    clangs = [load(f'metal_hit_0{i}.ogg') for i in range(1, 6)] + [load(f'bfh1_metal_hit_0{i}.ogg') for i in range(1, 7)]
    put('clang', [norm(trim(c), 0.85) for c in clangs[:8]])
    put('parry', [norm(reverb(mix((trim(c), 1, 0), (chime(1320 + 120 * i), 0.35, 0.0)), 0.9, 0.3), 0.9) for i, c in enumerate(clangs[:4])])
    hits = [load(f'bfh1_hit_{i:02d}.ogg') for i in range(1, 14)]
    blades = [load(f'blade_0{i}.ogg') for i in (1, 2, 3)]
    # cutting a Hollow: blade bite + a dry crunch of ash
    cuts = []
    for i in range(6):
        h = trim(hits[i])
        b = trim(blades[i % 3])
        crunch = bp_noise(0.25, 2000, 8000, lambda t: np.exp(-t * 14))
        cuts.append(norm(mix((b, 0.8, 0), (lp_fast(h, 3000), 0.9, 0.0), (crunch, 0.35, 0.0)), 0.9))
    put('cut', cuts)
    put('impact_heavy', [norm(mix((lp_fast(trim(hits[i]), 1200), 1, 0), (lp_fast(trim(load(f'cannon_0{1 + i % 5}.ogg')), 300), 0.5, 0)), 0.95) for i in range(4)])
    put('block', [norm(mix((trim(clangs[i]), 1, 0), (lp_fast(trim(hits[i + 4]), 1500), 0.5, 0)), 0.85) for i in range(4)])
    put('thud', [norm(lp_fast(trim(load(f'bfh1_falling_0{i}.ogg')), 1500), 0.8) for i in (1, 2, 3, 4)])
    put('slam', [norm(mix((lp_fast(trim(load(f'slam_0{i}.ogg')), 900), 1, 0), (lp_fast(trim(load('explosion.ogg')), 250), 0.6, 0)), 0.95) for i in (1, 2, 3)])
    put('stagger', [norm(reverb(mix((trim(clangs[5]), 1, 0), (chime(520), 0.5, 0.0)), 1.0, 0.3), 0.85)])
    put('ignite', [norm(trim(load(f'spell_fire_0{i}.ogg')), 0.85) for i in range(1, 8)])
    put('burst', [norm(mix((trim(load('explosion.ogg')), 1, 0), (trim(load('spell_fire_07.ogg')), 0.7, 0.05)), 0.95)])
    put('heal', [norm(reverb(mix((trim(load('magic1.wav')), 0.8, 0), (chime(660), 0.6, 0.05)), 1.0, 0.35), 0.8)])
    put('perfect', [chime(990), chime(1180)])
    put('deny', [norm(trim(load('interface3.wav')), 0.5)])
    put('ui', [norm(trim(load(f'interface{i}.wav')), 0.5) for i in range(1, 7)])
    put('gong', [norm(reverb(trim(load('gong_01.ogg')), 2.0, 0.3), 0.9), norm(reverb(trim(load('gong_02.ogg')), 2.0, 0.3), 0.9)])
    put('bell', [norm(reverb(trim(load(f'bell_0{i}.ogg')), 1.5, 0.35), 0.8) for i in (1, 2, 3)])
    put('glint', [norm(reverb(chime(1760), 0.8, 0.4), 0.8)])
    # the Hollow
    put('hollow_alert', [norm(trim(load(f'shade{i}.wav')), 0.8) for i in (1, 3, 5, 7)])
    put('hollow_hurt', [norm(trim(load(f'shade{i}.wav')), 0.75) for i in (2, 4, 6, 8, 10)])
    put('hollow_die', [norm(reverb(trim(load(f'shade{i}.wav')), 1.0, 0.3), 0.85) for i in (11, 12, 13, 14, 15)])
    put('brute', [norm(trim(load(f'mnstr{i}.wav')), 0.85) for i in (1, 2, 3, 5, 8)])
    put('boss_roar', [norm(reverb(trim(load(f'giant{i}.wav')), 1.5, 0.3), 0.95) for i in (1, 2, 3, 4, 5)])
    put('roar', [norm(trim(load(f'creature_roar_0{i}.ogg')), 0.9) for i in (1, 2, 3)])
    # player
    put('kaede_hurt', [norm(pitch(trim(load(f'hurt_0{i}.ogg')), 1.25), 0.6) for i in (1, 2, 3, 4)])
    # footsteps (synth)
    for k in ('grass', 'stone', 'wood', 'snow', 'water', 'dirt'):
        put('step_' + k, [footstep(k) for _ in range(4)], 80)
    put('step_heavy', [norm(mix((footstep('stone'), 1, 0), (lp_fast(trim(hits[8 + i]), 600), 0.6, 0)), 0.8) for i in range(3)], 80)
    put('cloth', [norm(trim(load('cloth.wav')), 0.5), norm(trim(load('cloth-heavy.wav')), 0.5)])
    put('armor', [norm(trim(load('armor-light.wav')), 0.5), norm(trim(load('chainmail1.wav')), 0.5)])
    put('wood_break', [norm(trim(load(f'wood_breaking_0{i}.ogg')), 0.85) for i in (1, 2)])
    put('door', [norm(trim(load('door.wav')), 0.7)])
    put('pickup', [norm(trim(load(f'item_gem_0{i}.ogg')), 0.7) for i in (1, 2, 3, 4)])
    put('heartbeat', [heartbeat()])
    put('thunder', [norm(reverb(lp_fast(mix((trim(load(f'cannon_0{i}.ogg')), 1, 0), (trim(load('explosion.ogg')), 0.8, 0.1)), 500 + 300 * i), 3.0, 0.5), 0.95) for i in (1, 2, 3)])
    # loops (stereo-free mono, long)
    for k, d in (('rain', 12), ('wind', 14), ('fire', 10), ('lava', 12), ('cave', 14)):
        put('loop_' + k, [loop_noise(d, k)], 96)
    forest = load('Forest_Ambience.mp3') if glob.glob(os.path.join(RAW, 'Forest_Ambience.mp3')) else None
    if forest is not None:
        put('loop_forest', [norm(forest[: SR * 30], 0.6)], 96)
    json.dump(M, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('built', len(M), 'sounds', sum(M.values()), 'files')


if __name__ == '__main__':
    build()
