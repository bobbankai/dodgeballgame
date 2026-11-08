"""Synthesises the game's sound effects and writes public/assets/audio/sfx/*.ogg + the manifest.

  /opt/bvenv/bin/python eclipse/tools/audio/sfx.py

Everything is generated (no samples): whooshes are noise shaped in the short-time Fourier domain by
a moving band; metal is modal synthesis (inharmonic plate/bar partials with per-partial decay, a
noise transient and a body thump); creature voices are glottal pulse trains through formant
resonators with breath noise and saturation; fire is granular crackle over filtered rumble.
Each sound gets several variants so repeats never sound identical.
"""
import json
import os
import subprocess
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'audio')
OUT = os.path.join(ROOT, 'sfx')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
MANIFEST = {}


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def env(dur, attack, decay_shape=4.0, hold=0.0):
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-np.clip(t - attack - hold, 0, None) * decay_shape / max(dur - attack, 1e-3))
    return a * d


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR / 2 - 100)], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='high', fs=SR, output='sos'), x)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def brown(dur):
    x = np.cumsum(rng.standard_normal(int(dur * SR)))
    x = hp(x, 15)
    return x / (np.abs(x).max() + 1e-9)


def band_sweep(dur, f0, f1, width=0.6, curve=1.0):
    """Noise whose energy band moves from f0 to f1 (log), shaped in the STFT domain."""
    x = noise(dur + 0.1)
    f, tt, Z = signal.stft(x, SR, nperseg=1024, noverlap=768)
    u = np.clip(tt / dur, 0, 1) ** curve
    fc = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * u)
    lf = np.log(np.maximum(f, 1))[:, None]
    mask = np.exp(-((lf - np.log(fc)[None, :]) / width) ** 2)
    _, y = signal.istft(Z * mask, SR, nperseg=1024, noverlap=768)
    return y[:int(dur * SR)]


def modal(dur, f0, ratios, decays, amps, detune=0.004):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for r, d, a in zip(ratios, decays, amps):
        f = f0 * r * (1 + rng.normal(0, detune))
        ph = rng.random() * np.pi * 2
        y += a * np.sin(2 * np.pi * f * t + ph) * np.exp(-t / d)
    return y


def reverb(x, seconds=1.2, mix=0.25, bright=0.5):
    """Convolution with a synthetic decaying-noise impulse response."""
    n = int(seconds * SR)
    # never let the dry signal stop dead (a click right where the tail takes over)
    k = min(len(x) // 3, int(0.08 * SR))
    x = x.copy()
    x[-k:] *= np.linspace(1, 0, k) ** 2
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 6.9 / seconds)
    ir = lp(ir, 2000 + 9000 * bright)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    wet = np.zeros(len(x) + n)
    c = signal.fftconvolve(x, ir)
    wet[: len(c)] = c[: len(x) + n]
    wet /= np.abs(wet).max() + 1e-9
    dry = np.concatenate([x, np.zeros(n)])
    dry /= np.abs(dry).max() + 1e-9
    return dry * (1 - mix) + wet * mix


def glottal(dur, f_contour, jitter=0.02, shimmer=0.1):
    """A pulse train (vocal folds) following a pitch contour (array or callable of t)."""
    t = t_axis(dur)
    f = f_contour(t) if callable(f_contour) else np.interp(t, np.linspace(0, dur, len(f_contour)), f_contour)
    f = f * (1 + jitter * lp(rng.standard_normal(len(t)), 30) * 8)
    ph = np.cumsum(f / SR)
    saw = 2 * (ph % 1.0) - 1
    pulse = np.tanh(3 * saw) * (1 + shimmer * lp(rng.standard_normal(len(t)), 20) * 8)
    return pulse


def formants(x, freqs, bws, gains):
    y = np.zeros_like(x)
    for f, b, g in zip(freqs, bws, gains):
        y += g * bp(x, max(30, f - b / 2), f + b / 2, 2)
    return y


def norm(x, peak=0.89):
    x = x - np.mean(x)
    return x / (np.abs(x).max() + 1e-9) * peak


def fade(x, a=0.003, b=0.02):
    n = len(x)
    x = x.copy()
    na, nb = int(a * SR), int(b * SR)
    x[:na] *= np.linspace(0, 1, na)
    x[n - nb:] *= np.linspace(1, 0, nb)
    return x


def loopify(x, xf=0.5):
    """Crossfades the tail into the head so the buffer loops seamlessly."""
    n = int(xf * SR)
    head, body, tail = x[:n], x[n:-n], x[-n:]
    w = np.linspace(0, 1, n)
    return np.concatenate([body, tail * (1 - w) + head * w])


def write(name, x, **mix):
    """Writes one variant (name_N) and registers it in the manifest under the base name."""
    base = name.rsplit('_', 1)[0] if name[-1].isdigit() and '_' in name else name
    fn = f'{name}.ogg'
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        wavfile.write(tf.name, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tf.name, '-c:a', 'libvorbis', '-q:a', '5', os.path.join(OUT, fn)], check=True)
        os.unlink(tf.name)
    d = MANIFEST.setdefault(base, {'files': []})
    d['files'].append(f'sfx/{fn}')
    d.update(mix)


# ============================================================================== weapons
def swings():
    for i in range(4):
        d = rng.uniform(0.28, 0.36)
        x = band_sweep(d, rng.uniform(500, 700), rng.uniform(1800, 2600), 0.55, 0.8) * env(d, d * 0.55, 6)
        write(f'swing_light_{i}', norm(fade(x), 0.7), volume=0.55, pitch=1.2, ref=3)
    for i in range(3):
        d = rng.uniform(0.5, 0.6)
        x = band_sweep(d, 220, 900, 0.6, 0.9) * env(d, d * 0.6, 5) + 0.4 * band_sweep(d, 90, 260, 0.5) * env(d, d * 0.65, 5)
        write(f'swing_heavy_{i}', norm(fade(x), 0.8), volume=0.7, pitch=0.8, ref=4)
    for i in range(3):
        d = 0.85
        x = band_sweep(d, 120, 600, 0.6, 1.1) * env(d, d * 0.62, 5) + 0.6 * lp(brown(d), 200) * env(d, d * 0.6, 4)
        write(f'swing_great_{i}', norm(fade(x), 0.85), volume=0.85, pitch=0.6, ref=7)


def impacts():
    plate = ([1, 2.76, 5.40, 8.93, 13.34, 19.1], [0.35, 0.22, 0.13, 0.08, 0.05, 0.03], [1, 0.7, 0.5, 0.35, 0.22, 0.12])
    for i in range(4):
        d = 0.9
        f0 = rng.uniform(520, 900)
        ring = modal(d, f0, *plate)
        trans = bp(noise(d), 2500, 9000) * env(d, 0.001, 140)
        thump = np.sin(2 * np.pi * 95 * t_axis(d)) * env(d, 0.002, 60)
        x = 0.55 * ring * env(d, 0.001, 3) + 0.6 * trans + 0.5 * thump
        write(f'hit_metal_{i}', norm(fade(reverb(x, 0.5, 0.15))), volume=0.9, pitch=1.5, ref=5)
    for i in range(4):
        d = 0.5
        t = t_axis(d)
        body = np.sin(2 * np.pi * (130 * np.exp(-t * 12) + 55) * t) * env(d, 0.002, 18)
        crunch = bp(noise(d), 400, 2400) * env(d, 0.001, 60) * (1 + 0.8 * (rng.random(len(t)) > 0.97))
        puff = hp(noise(d), 3000) * env(d, 0.005, 30) * 0.12
        write(f'hit_ash_{i}', norm(fade(body * 0.9 + crunch * 0.6 + puff)), volume=0.85, pitch=1.5, ref=5)
    for i in range(3):
        d = 0.7
        ring = modal(d, rng.uniform(900, 1300), *plate)
        trans = bp(noise(d), 3000, 12000) * env(d, 0.0005, 200)
        x = 0.7 * ring * env(d, 0.001, 5) + 0.8 * trans
        write(f'block_{i}', norm(fade(reverb(x, 0.4, 0.12))), volume=0.85, pitch=1.2, ref=5)
    for i in range(2):
        d = 1.8
        a = modal(d, 1180, *plate) * env(d, 0.001, 2.2)
        b = modal(d, 1760, [1, 2.0, 3.01], [1.2, 0.8, 0.5], [0.6, 0.3, 0.2]) * env(d, 0.001, 1.6)
        spark = hp(noise(d), 5000) * env(d, 0.0005, 60)
        write(f'parry_{i}', norm(fade(reverb(0.6 * a + 0.5 * b + 0.5 * spark, 1.4, 0.3, 0.8))), volume=0.95, pitch=0.4, ref=6)
    # heavy ground slam: a deep boom, rubble, and a ring of the blade
    for i in range(3):
        d = 2.0
        t = t_axis(d)
        boom = np.sin(2 * np.pi * (60 * np.exp(-t * 3) + 32) * t) * env(d, 0.004, 5)
        rubble = lp(noise(d), 1800) * env(d, 0.01, 7) * (0.6 + 0.4 * (rng.random(len(t)) > 0.995))
        crack = bp(noise(d), 1500, 6000) * env(d, 0.001, 40)
        write(f'slam_{i}', norm(fade(reverb(boom + 0.5 * rubble + 0.5 * crack, 1.8, 0.3, 0.3))), volume=1.0, pitch=0.6, ref=12)


# ============================================================================== movement
def movement():
    for i in range(5):
        d = 0.22
        click = bp(noise(d), 1800, 7000) * env(d, 0.001, 70)
        tap = bp(noise(d), 80, 350) * env(d, 0.002, 30)
        grit = bp(noise(d), 600, 3000) * env(d, 0.004, 25) * (rng.random(int(d * SR)) > 0.9)
        write(f'step_stone_{i}', norm(fade(0.5 * click + 0.9 * tap + 0.3 * grit)), volume=0.32, pitch=2, ref=2.5)
    for i in range(5):
        d = 0.3
        grains = (rng.random(int(d * SR)) > 0.985).astype(float)
        crunch = bp(grains + 0.2 * noise(d), 500, 4000) * env(d, 0.01, 12)
        tap = bp(noise(d), 60, 250) * env(d, 0.004, 25)
        write(f'step_ash_{i}', norm(fade(0.7 * crunch + tap)), volume=0.3, pitch=2, ref=2.5)
    for i in range(3):
        d = 0.5
        thud = bp(noise(d), 50, 300) * env(d, 0.003, 14)
        jingle = modal(d, 2400, [1, 1.5, 2.3], [0.12, 0.08, 0.05], [0.3, 0.2, 0.1]) * env(d, 0.001, 8)
        write(f'land_{i}', norm(fade(thud + 0.25 * jingle)), volume=0.6, pitch=1.5, ref=3)
    for i in range(3):
        d = 0.45
        cloth = band_sweep(d, 300, 1200, 0.7) * env(d, d * 0.4, 5)
        jingle = sum(modal(d, rng.uniform(2000, 3200), [1, 1.6], [0.06, 0.04], [0.3, 0.15]) * np.roll(env(d, 0.001, 30), int(rng.uniform(0, 0.25) * SR)) for _ in range(3))
        write(f'dodge_{i}', norm(fade(0.8 * cloth + 0.2 * jingle)), volume=0.5, pitch=1.5, ref=3)
    for i in range(3):
        d = 1.2
        body = bp(noise(d), 40, 260) * env(d, 0.003, 9)
        armour = modal(d, 700, [1, 2.76, 5.4], [0.2, 0.12, 0.06], [0.5, 0.3, 0.2]) * env(d, 0.002, 6)
        write(f'bodyfall_{i}', norm(fade(body + 0.35 * armour)), volume=0.7, pitch=1.5, ref=5)
    # the boss's footfalls
    for i in range(3):
        d = 1.4
        t = t_axis(d)
        boom = np.sin(2 * np.pi * (45 * np.exp(-t * 4) + 28) * t) * env(d, 0.005, 6)
        grit = lp(noise(d), 900) * env(d, 0.01, 10)
        write(f'step_giant_{i}', norm(fade(boom + 0.4 * grit)), volume=0.9, pitch=1, ref=14)


# ============================================================================== fire and magic
def fire():
    # crackling fire loop: pops and snaps over a soft roar
    d = 9.0
    t = t_axis(d)
    roar = lp(brown(d), 500) * (0.7 + 0.3 * lp(rng.standard_normal(len(t)), 1.5) * 20)
    pops = np.zeros(len(t))
    for _ in range(int(d * 22)):
        k = int(rng.random() * (len(t) - 2000))
        L = int(rng.uniform(0.002, 0.012) * SR)
        pops[k:k + L] += rng.uniform(0.3, 1.0) * np.exp(-np.arange(L) / (L / 4)) * rng.standard_normal(L)
    pops = bp(pops, 900, 9000)
    x = loopify(0.6 * roar / np.abs(roar).max() + 0.8 * pops / np.abs(pops).max(), 0.6)
    write('fire_loop', norm(x, 0.7), volume=0.7, ref=4, bus='ambience', pitch=0)
    # lava: deep rumble and slow bubbling
    d = 10.0
    t = t_axis(d)
    rumble = lp(brown(d), 120)
    bub = np.zeros(len(t))
    for _ in range(int(d * 3)):
        k = int(rng.random() * (len(t) - 20000))
        L = int(rng.uniform(0.08, 0.25) * SR)
        f = rng.uniform(60, 160)
        bub[k:k + L] += np.sin(2 * np.pi * np.linspace(f, f * 1.8, L) * np.arange(L) / SR) * np.hanning(L)
    write('lava_loop', norm(loopify(rumble + 0.5 * lp(bub, 600), 0.8), 0.75), volume=0.8, ref=5, bus='ambience', pitch=0)
    # wind over the ash fields
    d = 14.0
    t = t_axis(d)
    gust = 0.5 + 0.5 * lp(rng.standard_normal(len(t)), 0.3) * 60
    w = bp(noise(d), 180, 1400) * np.clip(gust, 0.1, 1.5)
    whistle = bp(noise(d), 900, 1100) * np.clip(gust - 0.6, 0, 1) * 0.6
    write('wind_loop', norm(loopify(w + whistle + 0.4 * lp(brown(d), 200), 1.0), 0.6), volume=0.55, bus='ambience', pitch=0)
    for i in range(3):
        d = 1.2
        boom = lp(noise(d), 1200) * env(d, 0.003, 6)
        crack = bp(noise(d), 1000, 7000) * env(d, 0.001, 25)
        roarf = band_sweep(d, 300, 120, 0.8) * env(d, 0.02, 4)
        write(f'fire_burst_{i}', norm(fade(reverb(boom + 0.5 * crack + 0.7 * roarf, 1.0, 0.2))), volume=0.9, pitch=1.2, ref=8)
    for i in range(3):
        d = 0.8
        x = band_sweep(d, 200, 1400, 0.7, 0.7) * env(d, 0.15, 4) + 0.4 * bp(noise(d), 2000, 8000) * env(d, 0.05, 6)
        write(f'fire_cast_{i}', norm(fade(x)), volume=0.7, pitch=1.5, ref=6)
    for i in range(2):
        d = 3.0
        t = t_axis(d)
        swell = band_sweep(d, 80, 400, 0.8, 0.6) * np.clip(t / 2.4, 0, 1) ** 2
        write(f'fire_charge_{i}', norm(fade(swell)), volume=0.8, pitch=0.5, ref=10)
    # aether: glassy shimmer for perfect dodges and abilities
    for i in range(2):
        d = 1.6
        t = t_axis(d)
        notes = [880, 1320, 1760, 2640]
        x = sum(np.sin(2 * np.pi * f * t) * np.exp(-np.clip(t - k * 0.05, 0, None) * 3) * (t > k * 0.05) for k, f in enumerate(notes))
        write(f'aether_{i}', norm(fade(reverb(x, 1.5, 0.4, 0.9))), volume=0.6, pitch=0.5)
    d = 2.0
    t = t_axis(d)
    notes = [523, 659, 784, 1046, 1318]
    x = sum(np.sin(2 * np.pi * f * t) * np.exp(-np.clip(t - k * 0.09, 0, None) * 2) * (t > k * 0.09) for k, f in enumerate(notes))
    write('heal', norm(fade(reverb(x + 0.1 * hp(noise(d), 6000) * env(d, 0.3, 4), 1.8, 0.4, 0.9))), volume=0.6, pitch=0)
    d = 1.8
    hiss = hp(noise(d), 2500) * env(d, 0.05, 4) * (0.7 + 0.3 * (rng.random(int(d * SR)) > 0.98))
    write('ash_dissolve', norm(fade(hiss + 0.3 * bp(noise(d), 200, 800) * env(d, 0.1, 3))), volume=0.55, pitch=1, ref=5)


# ============================================================================== voices
def voices():
    # Ignaroth's roar: a huge, slow glottal growl through a giant's vowel tract
    for i in range(2):
        d = 2.6
        f = lambda t: 38 + 22 * np.sin(np.pi * np.clip(t / 2.2, 0, 1)) + 6 * (i == 1)  # noqa: E731
        src = glottal(d, f, jitter=0.05, shimmer=0.3)
        v = formants(src, [420, 760, 1650, 2400], [140, 180, 260, 360], [1, 0.8, 0.4, 0.2])
        v /= np.abs(v).max() + 1e-9
        breath = bp(noise(d), 300, 2500) * 0.08
        x = np.tanh(1.6 * (v + breath)) * env(d, 0.25, 6, hold=1.0)
        x += 0.5 * lp(brown(d), 90) * env(d, 0.3, 3)
        write(f'roar_giant_{i}', norm(fade(reverb(x, 2.2, 0.35, 0.4))), volume=1.0, pitch=0.5, ref=20, bus='voice')
    for i in range(4):
        d = rng.uniform(0.9, 1.3)
        f = lambda t, d=d: 95 + 25 * np.sin(np.pi * np.clip(t / d, 0, 1)) - 20 * (t / d)  # noqa: E731
        src = glottal(d, f, jitter=0.08, shimmer=0.4)
        v = formants(src + 0.6 * noise(d), [450, 800, 2300], [200, 250, 400], [1, 0.6, 0.3])
        write(f'thrall_groan_{i}', norm(fade(np.tanh(1.8 * v) * env(d, 0.08, 3, hold=d * 0.4))), volume=0.6, pitch=1.5, ref=6, bus='voice')
    for i in range(3):
        d = 0.45
        src = glottal(d, lambda t: 120 - 30 * t / 0.45, jitter=0.03)
        v = formants(src, [700, 1150, 2500], [150, 200, 350], [1, 0.7, 0.3]) + 0.3 * bp(noise(d), 500, 3000)
        write(f'knight_effort_{i}', norm(fade(np.tanh(2 * v) * env(d, 0.02, 6))), volume=0.6, pitch=1.2, ref=6, bus='voice')
    for i in range(4):
        d = 0.35
        src = glottal(d, lambda t: 140 - 40 * t / 0.35, jitter=0.02)
        v = formants(src, [650, 1100, 2450], [120, 180, 300], [1, 0.6, 0.25]) + 0.25 * bp(noise(d), 600, 3500)
        write(f'kael_effort_{i}', norm(fade(np.tanh(1.5 * v) * env(d, 0.015, 7))), volume=0.45, pitch=1, ref=3, bus='voice')
    for i in range(3):
        d = 0.5
        src = glottal(d, lambda t: 160 + 30 * np.exp(-t * 10), jitter=0.04)
        v = formants(src, [600, 1000, 2400], [130, 200, 320], [1, 0.6, 0.3]) + 0.4 * bp(noise(d), 800, 4000)
        write(f'kael_hurt_{i}', norm(fade(np.tanh(2 * v) * env(d, 0.01, 6))), volume=0.55, pitch=1, ref=3, bus='voice')


# ============================================================================== interface and cinematic
def ui():
    d = 0.08
    write('ui_move', norm(fade(bp(noise(d), 2000, 6000) * env(d, 0.001, 50)), 0.5), volume=0.35, pitch=0.5, bus='ui')
    d = 0.4
    t = t_axis(d)
    x = (np.sin(2 * np.pi * 660 * t) + 0.5 * np.sin(2 * np.pi * 990 * t)) * env(d, 0.002, 7)
    write('ui_confirm', norm(fade(reverb(x, 0.6, 0.25))), volume=0.4, pitch=0, bus='ui')
    d = 4.0
    t = t_axis(d)
    boom = np.sin(2 * np.pi * (48 * np.exp(-t * 1.5) + 30) * t) * env(d, 0.01, 3)
    shimmer = hp(noise(d), 4000) * env(d, 0.5, 3) * 0.15
    brass = formants(glottal(d, lambda t: 73.4 + 0 * t, 0.002, 0.02), [500, 1000, 1500], [200, 300, 400], [1, 0.6, 0.3]) * env(d, 0.1, 3) * 0.4
    write('banner_boom', norm(fade(reverb(boom + shimmer + brass, 3.0, 0.4, 0.5))), volume=0.8, pitch=0, bus='ui')


swings()
impacts()
movement()
fire()
voices()
ui()
man_path = os.path.join(ROOT, 'manifest.json')
man = json.load(open(man_path)) if os.path.exists(man_path) else {'sounds': {}, 'music': {}}
man['sounds'] = MANIFEST
json.dump(man, open(man_path, 'w'), indent=1)
print(len(MANIFEST), 'sounds,', sum(len(v['files']) for v in MANIFEST.values()), 'files')
