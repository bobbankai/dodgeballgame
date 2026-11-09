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


# ============================================================================== water (Chapter Two)
def bubble(dur, f0, rise=0.6, decay=40.0):
    """A single bubble ringing at its Minnaert resonance, chirping upward as it rises."""
    t = t_axis(dur)
    f = f0 * (1 + rise * t / max(dur, 1e-3))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)


def bubbles(d, density, f_lo, f_hi, amp=1.0, decay=(25, 80)):
    """A cloud of bubbles scattered in time (Poisson), log-uniform in pitch."""
    n = int(d * SR)
    x = np.zeros(n)
    for _ in range(int(d * density)):
        k = int(rng.random() * (n - 4000))
        f0 = np.exp(rng.uniform(np.log(f_lo), np.log(f_hi)))
        L = 3000
        b = bubble(L / SR, f0, rng.uniform(0.2, 1.2), rng.uniform(*decay))
        x[k:k + L] += b * rng.uniform(0.2, 1.0) * amp
    return x


def water():
    # wading: a push of water, a slosh and a few bubbles (five variants)
    for i in range(5):
        d = 0.55
        push = bp(noise(d), 250, 2400) * env(d, 0.04, 7)
        slosh = bp(noise(d), 600, 5000) * env(d, 0.12, 6) * 0.6
        x = push + slosh + 0.35 * bubbles(d, 30, 500, 1800)
        write(f'step_water_{i}', norm(fade(x), 0.8), volume=0.55, pitch=1.5, ref=3)
    # splash: a body or blast hitting water
    for i in range(3):
        d = 1.4
        crash = bp(noise(d), 300, 7000) * env(d, 0.006, 9)
        sheet = hp(noise(d), 1800) * env(d, 0.08, 5) * 0.5
        x = crash + sheet + 0.5 * bubbles(d, 70, 300, 2200) * env(d, 0.05, 3)
        write(f'splash_{i}', norm(fade(reverb(x, 0.8, 0.15))), volume=0.8, pitch=1.2, ref=6)
    # geyser: a deep boom from below, then the column roaring up and spattering down
    for i in range(2):
        d = 3.2
        t = t_axis(d)
        boom = np.sin(2 * np.pi * (55 * np.exp(-t * 2) + 28) * t) * env(d, 0.01, 7)
        column = band_sweep(d, 300, 2400, 0.9, 0.7) * env(d, 0.15, 4, hold=0.4)
        rain_back = bp(noise(d), 1500, 9000) * np.clip((t - 0.9) / 0.4, 0, 1) * np.exp(-np.clip(t - 1.3, 0, None) * 2)
        x = 0.9 * boom + column + 0.6 * rain_back + 0.4 * bubbles(d, 60, 150, 900)
        write(f'geyser_{i}', norm(fade(reverb(x, 1.6, 0.25, 0.5))), volume=0.95, pitch=0.8, ref=12)
    # a wave: the rolling roar of a wall of water, cresting and breaking
    for i in range(2):
        d = 4.0
        t = t_axis(d)
        swell = np.clip(t / 2.6, 0, 1) ** 1.5 * np.exp(-np.clip(t - 2.8, 0, None) * 2.5)
        roar = (lp(brown(d), 380) * 1.2 + bp(noise(d), 300, 3000) * 0.5) * swell
        crash = bp(noise(d), 800, 9000) * np.clip((t - 2.6) / 0.15, 0, 1) * np.exp(-np.clip(t - 2.75, 0, None) * 3)
        x = roar + 0.8 * crash + 0.3 * bubbles(d, 50, 200, 1200) * swell
        write(f'wave_roll_{i}', norm(fade(reverb(x, 1.5, 0.2, 0.4))), volume=1.0, pitch=0.5, ref=14)
    # water magic: a gurgling rise
    for i in range(3):
        d = 0.9
        t = t_axis(d)
        rise = band_sweep(d, 300, 1500, 0.5, 0.6) * env(d, 0.3, 4)
        x = rise + 0.7 * bubbles(d, 80, 400 + 200 * t.mean(), 2500) * env(d, 0.2, 3)
        write(f'water_cast_{i}', norm(fade(reverb(x, 0.8, 0.25, 0.7))), volume=0.7, pitch=1.4, ref=6)
    # whirlpool: a long swirling suck, sweeping in pitch as it turns
    d = 6.0
    t = t_axis(d)
    turn = 0.5 + 0.5 * np.sin(2 * np.pi * 0.6 * t)
    x = bp(noise(d), 200, 1600) * (0.5 + 0.5 * turn) + lp(brown(d), 160) * 0.8 + 0.4 * bubbles(d, 40, 120, 700)
    x *= env(d, 0.8, 2.5, hold=3.0)
    write('whirlpool', norm(fade(x, 0.2, 0.8), 0.8), volume=0.8, pitch=0.6, ref=8)
    # the brine dissolve: water streaming away, fizzing
    d = 1.8
    x = bp(noise(d), 1500, 8000) * env(d, 0.08, 4) * 0.6 + bubbles(d, 120, 600, 3000) * env(d, 0.1, 3)
    write('brine_dissolve', norm(fade(x)), volume=0.55, pitch=1, ref=5)
    # rain: dense droplet ticks on stone and water, a hiss, and soft low weight (seamless loop)
    d = 12.0
    t = t_axis(d)
    hiss = bp(noise(d), 1200, 9000) * (0.75 + 0.25 * lp(rng.standard_normal(len(t)), 0.4) * 40)
    ticks = np.zeros(len(t))
    for _ in range(int(d * 600)):
        k = int(rng.random() * (len(t) - 600))
        L = int(rng.uniform(0.0008, 0.004) * SR)
        ticks[k:k + L] += rng.uniform(0.1, 1) * np.exp(-np.arange(L) / (L / 5)) * rng.standard_normal(L)
    ticks = bp(ticks, 2000, 12000)
    drops = bubbles(d, 180, 900, 4000, 0.6, decay=(60, 140))
    x = 0.5 * hiss / np.abs(hiss).max() + 0.6 * ticks / np.abs(ticks).max() + 0.4 * drops / (np.abs(drops).max() + 1e-9) + 0.25 * lp(brown(d), 250)
    write('rain_loop', norm(loopify(x, 1.0), 0.6), volume=0.6, bus='ambience', pitch=0)
    # lapping: slow wavelets slapping against stone in the flooded streets (positional loop)
    d = 10.0
    t = t_axis(d)
    x = np.zeros(len(t))
    k = 0
    while k < len(t) - SR:
        L = int(rng.uniform(0.35, 0.8) * SR)
        seg = bp(noise(L / SR), 200, 2200) * np.hanning(L) ** 2
        x[k:k + L] += seg * rng.uniform(0.4, 1)
        k += int(rng.uniform(0.6, 1.6) * SR)
    x += 0.5 * bubbles(d, 25, 200, 900) + 0.3 * lp(brown(d), 120)
    write('lap_loop', norm(loopify(x, 0.8), 0.65), volume=0.65, ref=4, bus='ambience', pitch=0)
    # waterfall: a broad, steady roar with some movement in it
    d = 10.0
    t = t_axis(d)
    move = 0.8 + 0.2 * lp(rng.standard_normal(len(t)), 0.8) * 30
    x = (bp(noise(d), 150, 5000) * 0.8 + lp(brown(d), 200) * 0.9) * move + 0.3 * bubbles(d, 100, 200, 1400)
    write('falls_loop', norm(loopify(x, 1.0), 0.7), volume=0.8, ref=8, bus='ambience', pitch=0)


def drowned_voices():
    # the drowned: a throat full of water, groaning through bubbles
    for i in range(4):
        d = rng.uniform(1.0, 1.4)
        f = lambda t, d=d: 82 + 18 * np.sin(np.pi * np.clip(t / d, 0, 1)) - 14 * (t / d)  # noqa: E731
        src = glottal(d, f, jitter=0.1, shimmer=0.5)
        gurgle = 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(9, 14) * t_axis(d))
        v = formants(src * gurgle + 0.4 * noise(d), [380, 700, 2100], [220, 280, 420], [1, 0.55, 0.25])
        v = np.tanh(1.7 * v / (np.abs(v).max() + 1e-9))
        x = (v + 0.35 * bubbles(d, 60, 250, 1100)) * env(d, 0.1, 3, hold=d * 0.4)
        write(f'drowned_groan_{i}', norm(fade(x)), volume=0.6, pitch=1.5, ref=6, bus='voice')
    # Thaloryn: a sea-king's bellow, vast and wet, ending in a rush of water
    for i in range(2):
        d = 3.0
        t = t_axis(d)
        f = lambda t: 34 + 18 * np.sin(np.pi * np.clip(t / 2.4, 0, 1)) + 5 * (i == 1)  # noqa: E731
        src = glottal(d, f, jitter=0.05, shimmer=0.35)
        v = formants(src, [360, 680, 1500, 2300], [150, 190, 280, 380], [1, 0.85, 0.4, 0.2])
        v /= np.abs(v).max() + 1e-9
        x = np.tanh(1.5 * (v + bp(noise(d), 250, 2200) * 0.08)) * env(d, 0.3, 6, hold=1.2)
        x += 0.5 * lp(brown(d), 80) * env(d, 0.3, 3)
        x += 0.45 * bp(noise(d), 400, 6000) * np.clip((t - 1.9) / 0.4, 0, 1) * np.exp(-np.clip(t - 2.3, 0, None) * 4)
        x += 0.3 * bubbles(d, 50, 100, 600)
        write(f'roar_tide_{i}', norm(fade(reverb(x, 2.4, 0.35, 0.4))), volume=1.0, pitch=0.5, ref=20, bus='voice')


# ============================================================================== storm (Chapter Three)
def storm():
    # thunder close by: a ripping crack, then the rolling boom in a long tail
    for i in range(3):
        d = 5.0
        t = t_axis(d)
        crack = bp(noise(d), 1500, 12000) * np.exp(-t * 30) * 1.2
        rip = bp(noise(d), 300, 4000) * np.clip(t / 0.02, 0, 1) * np.exp(-t * 6)
        roll_env = np.exp(-np.clip(t - 0.15, 0, None) * 0.9) * np.clip(t / 0.12, 0, 1)
        roll = lp(brown(d), 160) * (0.6 + 0.4 * lp(rng.standard_normal(len(t)), 2.5) * 25) * roll_env
        x = 0.9 * crack + 0.7 * rip + 1.4 * roll
        write(f'thunder_{i}', norm(fade(reverb(x, 2.6, 0.35, 0.3), 0.001, 0.4)), volume=1.0, pitch=1.5, ref=60, bus='ambience')
    # thunder far off: only the low roll survives the distance
    for i in range(3):
        d = 6.0
        t = t_axis(d)
        swell = np.clip(t / rng.uniform(0.4, 0.9), 0, 1) ** 1.5 * np.exp(-np.clip(t - 1.0, 0, None) * 0.7)
        roll = lp(brown(d), 110) * (0.55 + 0.45 * lp(rng.standard_normal(len(t)), 1.8) * 25) * swell
        write(f'thunder_far_{i}', norm(fade(reverb(roll, 3.0, 0.4, 0.2), 0.05, 0.6), 0.7), volume=0.8, pitch=2, ref=200, bus='ambience')
    # the strike itself where it lands: a hard electric snap with a fizzing tail
    for i in range(3):
        d = 1.2
        t = t_axis(d)
        snap = noise(d) * np.exp(-t * 60) + 0.6 * bp(noise(d), 2000, 14000) * np.exp(-t * 9)
        buzz = np.sign(np.sin(2 * np.pi * rng.uniform(90, 140) * t)) * np.exp(-t * 7) * 0.15
        write(f'lightning_crack_{i}', norm(fade(snap + buzz)), volume=1.0, pitch=1.5, ref=12)
    for i in range(3):
        d = 0.45
        t = t_axis(d)
        x = bp(noise(d), 2500, 12000) * np.exp(-t * 14) * (0.6 + 0.4 * (rng.random(len(t)) > 0.92))
        x += np.sign(np.sin(2 * np.pi * 120 * t)) * np.exp(-t * 20) * 0.1
        write(f'shock_{i}', norm(fade(x)), volume=0.7, pitch=2, ref=5)
    # a gust: a whoosh of air driven past
    for i in range(3):
        d = 1.6
        x = band_sweep(d, 250, 1200, 0.8, 0.6) * env(d, 0.35, 3) + 0.4 * lp(brown(d), 300) * env(d, 0.3, 3)
        write(f'gust_{i}', norm(fade(x)), volume=0.8, pitch=1, ref=8)
    # storm magic gathering: a rising crackle and hum
    for i in range(3):
        d = 1.0
        t = t_axis(d)
        hum = np.sin(2 * np.pi * (110 + 80 * t) * t) * np.clip(t / 0.6, 0, 1) * 0.3
        crackle = bp(noise(d), 3000, 12000) * (rng.random(len(t)) > 0.985) * 3 * np.clip(t / 0.5, 0, 1)
        write(f'storm_cast_{i}', norm(fade(reverb(hum + lp(crackle, 9000), 0.6, 0.2, 0.8))), volume=0.7, pitch=1.4, ref=6)
    d = 1.8
    t = t_axis(d)
    x = bp(noise(d), 3000, 12000) * (rng.random(len(t)) > 0.97) * 2 * np.exp(-t * 1.5) + 0.3 * hp(noise(d), 5000) * env(d, 0.05, 4)
    write('storm_dissolve', norm(fade(lp(x, 11000))), volume=0.55, pitch=1, ref=5)


def storm_voices():
    # the monks' kiai: a short sharp shout
    for i in range(4):
        d = 0.38
        src = glottal(d, lambda t: 170 - 60 * t / 0.38 + 10 * i, jitter=0.02)
        v = formants(src, [750, 1200, 2600], [130, 180, 300], [1, 0.7, 0.3]) + 0.25 * bp(noise(d), 700, 4000)
        write(f'monk_kiai_{i}', norm(fade(np.tanh(1.8 * v) * env(d, 0.012, 6))), volume=0.5, pitch=1.2, ref=6, bus='voice')
    # Vaeltris: a vast cry, half a hawk's scream, half a choir, torn by wind
    for i in range(2):
        d = 2.8
        t = t_axis(d)
        f = lambda t: 300 + 260 * np.sin(np.pi * np.clip(t / 1.4, 0, 1)) - 120 * np.clip((t - 1.4) / 1.2, 0, 1) + 20 * i  # noqa: E731
        src = glottal(d, f, jitter=0.03, shimmer=0.25)
        v = formants(src, [800, 1400, 2900, 3800], [120, 160, 260, 400], [1, 0.8, 0.5, 0.3])
        v /= np.abs(v).max() + 1e-9
        choir = sum(np.sin(2 * np.pi * f0 * t) for f0 in (220, 277, 330)) * 0.12 * env(d, 0.4, 3, hold=1.0)
        wind = band_sweep(d, 400, 2000, 0.9, 0.5) * 0.4 * env(d, 0.3, 3)
        x = np.tanh(1.3 * v) * env(d, 0.15, 5, hold=1.0) + choir + wind
        write(f'roar_storm_{i}', norm(fade(reverb(x, 2.6, 0.4, 0.7))), volume=1.0, pitch=0.5, ref=20, bus='voice')


# ============================================================================== forest (Chapter Four)
def creak(d, f0, f1, rough=0.5):
    """Wood under strain: a slow stick-slip buzz whose pitch drifts, through a hollow resonance."""
    t = t_axis(d)
    f = f0 + (f1 - f0) * t / d + 6 * np.sin(2 * np.pi * 0.7 * t)
    ph = np.cumsum(f) / SR
    pulses = (np.mod(ph, 1.0) < 0.08 + 0.05 * rough * rng.random(len(t))).astype(float)
    x = bp(pulses - pulses.mean(), 150, 2400)
    return formants(x, [380, 900, 1900], [120, 200, 300], [1, 0.6, 0.3])


def forest():
    for i in range(4):
        d = rng.uniform(1.1, 1.5)
        groan = glottal(d, lambda t, d=d: 70 + 12 * np.sin(np.pi * np.clip(t / d, 0, 1)), jitter=0.12, shimmer=0.5)
        v = formants(groan + 0.3 * noise(d), [330, 650, 1800], [180, 240, 380], [1, 0.5, 0.2])
        x = 0.6 * np.tanh(1.5 * v / (np.abs(v).max() + 1e-9)) + 0.7 * creak(d, 18, 9) / 3
        write(f'thorn_groan_{i}', norm(fade(x * env(d, 0.15, 3, hold=d * 0.4))), volume=0.65, pitch=1.2, ref=7, bus='voice')
    for i in range(4):
        d = rng.uniform(0.9, 1.2)
        breath = bp(noise(d), 600, 4500) * env(d, 0.3, 3, hold=0.2)
        v = formants(glottal(d, lambda t: 230 - 40 * t, jitter=0.02) * 0.3 + noise(d) * 0.4, [800, 1300, 2800], [200, 260, 380], [1, 0.6, 0.3])
        write(f'bloom_sigh_{i}', norm(fade(reverb(breath + 0.4 * v * env(d, 0.25, 4), 1.0, 0.3, 0.8))), volume=0.5, pitch=1.2, ref=6, bus='voice')
    for i in range(2):
        d = 3.2
        t = t_axis(d)
        f = lambda t: 42 + 16 * np.sin(np.pi * np.clip(t / 2.6, 0, 1)) + 4 * i  # noqa: E731
        src = glottal(d, f, jitter=0.05, shimmer=0.35)
        v = formants(src, [360, 700, 1600, 2500], [150, 200, 280, 380], [1, 0.8, 0.4, 0.2])
        v /= np.abs(v).max() + 1e-9
        choir = sum(np.sin(2 * np.pi * f0 * t) for f0 in (196, 247, 294)) * 0.1 * env(d, 0.5, 3, hold=1.2)
        x = np.tanh(1.3 * v) * env(d, 0.3, 5, hold=1.3) + 0.6 * creak(d, 14, 6) / 3 * env(d, 0.2, 2) + choir
        x += 0.4 * lp(brown(d), 90) * env(d, 0.3, 3)
        write(f'roar_bloom_{i}', norm(fade(reverb(x, 2.4, 0.35, 0.5))), volume=1.0, pitch=0.5, ref=20, bus='voice')
    for i in range(3):
        d = 1.3
        t = t_axis(d)
        crack = bp(noise(d), 600, 6000) * np.exp(-t * 18) * (1 + 2 * (rng.random(len(t)) > 0.97))
        thump = np.sin(2 * np.pi * (70 * np.exp(-t * 4) + 40) * t) * np.exp(-t * 7)
        soil = bp(noise(d), 200, 1800) * env(d, 0.02, 6) * 0.6
        write(f'root_burst_{i}', norm(fade(crack + 0.9 * thump + soil + 0.5 * creak(d, 30, 12) / 3 * np.exp(-t * 3))), volume=0.9, pitch=1.4, ref=9)
    for i in range(3):
        d = 1.0
        x = bp(noise(d), 300, 3000) * env(d, 0.01, 5) + 0.3 * hp(noise(d), 4000) * env(d, 0.15, 4)
        write(f'spore_burst_{i}', norm(fade(reverb(x, 0.7, 0.2))), volume=0.6, pitch=1.5, ref=6)
    for i in range(3):
        d = 1.2
        t = t_axis(d)
        notes = [rng.choice([523, 587, 659, 784, 880]) for _ in range(4)]
        chime = sum(np.sin(2 * np.pi * f * t) * np.exp(-np.clip(t - k * 0.12, 0, None) * 4) * (t > k * 0.12) for k, f in enumerate(notes))
        rustle = bp(noise(d), 2000, 8000) * env(d, 0.3, 3) * (0.6 + 0.4 * (rng.random(len(t)) > 0.6))
        write(f'bloom_cast_{i}', norm(fade(reverb(0.4 * chime + 0.5 * rustle, 1.2, 0.35, 0.9))), volume=0.6, pitch=1, ref=6)
    d = 2.0
    t = t_axis(d)
    rustle = bp(noise(d), 1500, 9000) * env(d, 0.1, 3) * (0.5 + 0.5 * (rng.random(len(t)) > 0.7))
    chime = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * 2.5) for f in (659, 988, 1318)) * 0.2
    write('bloom_dissolve', norm(fade(reverb(rustle + chime, 1.4, 0.3, 0.9))), volume=0.55, pitch=1, ref=5)
    # the forest itself: leaves in the wind, wood creaking, insects, a far chime and a strange bird
    d = 16.0
    t = t_axis(d)
    gust = 0.5 + 0.5 * lp(rng.standard_normal(len(t)), 0.25) * 70
    leaves = bp(noise(d), 1200, 7000) * np.clip(gust, 0.1, 1.4) * (0.7 + 0.3 * (rng.random(len(t)) > 0.5))
    insects = np.sin(2 * np.pi * 4200 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 23 * t)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.13 * t)) * 0.05
    x = 0.5 * leaves / np.abs(leaves).max() + insects
    for _ in range(4):
        k = int(rng.uniform(0.5, d - 3) * SR)
        c = creak(2.0, rng.uniform(10, 22), rng.uniform(6, 12), 0.7)
        x[k:k + len(c)] += 0.25 * c / (np.abs(c).max() + 1e-9) * np.hanning(len(c))
    for _ in range(3):
        k = int(rng.uniform(0.5, d - 2) * SR)
        L = int(0.9 * SR)
        tt = np.arange(L) / SR
        f = rng.uniform(1800, 2600) * (1 + 0.3 * np.sin(2 * np.pi * 7 * tt))
        call = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 3) * (np.mod(tt, 0.3) < 0.18)
        x[k:k + L] += 0.12 * call
    write('forest_loop', norm(loopify(reverb(x, 1.6, 0.3, 0.7), 1.0), 0.6), volume=0.6, ref=12, bus='ambience', pitch=0)


swings()
impacts()
movement()
fire()
voices()
ui()
water()
drowned_voices()
storm()
storm_voices()
forest()
man_path = os.path.join(ROOT, 'manifest.json')
man = json.load(open(man_path)) if os.path.exists(man_path) else {'sounds': {}, 'music': {}}
# keep the recorded voice lines (tools/voices/record.py registers them in the same table)
man['sounds'] = {**{k: v for k, v in man.get('sounds', {}).items() if k.startswith('line:')}, **MANIFEST}
json.dump(man, open(man_path, 'w'), indent=1)
print(len(MANIFEST), 'sounds,', sum(len(v['files']) for v in MANIFEST.values()), 'files')
