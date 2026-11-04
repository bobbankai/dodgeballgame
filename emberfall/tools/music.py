#!/usr/bin/env python3
"""Emberfall score generator (run with /opt/venv/bin/python): composes every music cue from code and
renders it with the GeneralUser GS SoundFont (tinysoundfont), then reverb, gentle bus compression and
loop-safe tails, encoded to public/assets/audio/music/<cue>.mp3.

  music.py [cue ...]          (default: all cues)

The score is built on one theme (Kaede's), stated in the Japanese 'in' scale over a modal minor, then
re-orchestrated per chapter: shakuhachi, koto and strings in the village; choir and harp at the drowned
shrine; sparse bells in the snow; taiko and brass in the forge; everything at the Hollow Crown.
Loops are composed in whole bars; the reverb tail of each loop is folded back onto its start so the
cue loops without a seam.
"""
import os
import sys
import math
import random
import subprocess
import numpy as np
import tinysoundfont as tsf

SF = '/opt/raw/sf/GeneralUser-GS.sf2'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'audio', 'music')
SR = 44100

# General MIDI programs (0-based)
P = dict(strings=48, slow_strings=49, pizz=45, tremolo=44, cello=42, contrabass=43, harp=46, timpani=47, choir=52, voice_oohs=53,
         horn=60, brass=61, trombone=57, shakuhachi=77, flute=73, pan=75, koto=107, shamisen=106, taiko=116, celesta=8,
         bells=14, music_box=10, warm_pad=89, halo_pad=94, piano=0, glock=9, woodblock=115, choir_pad=91)

# scales as semitone offsets
IN_SCALE = [0, 1, 5, 7, 8]          # miyako-bushi ('in'): dark, Japanese
AEOLIAN = [0, 2, 3, 5, 7, 8, 10]
YO = [0, 2, 5, 7, 9]

# Kaede's theme: (scale degree in AEOLIAN from the tonic, beats); 7 = octave
THEME = [(4, 1), (7, 1.5), (8, 0.5), (9, 1), (8, 0.5), (7, 0.5), (6, 1), (4, 2),
         (3, 1), (4, 1), (7, 1.5), (6, 0.5), (4, 2), (3, 1), (2, 1),
         (4, 1), (7, 1.5), (8, 0.5), (9, 1.5), (11, 0.5), (10, 1), (9, 0.5), (8, 0.5), (7, 2),
         (6, 1), (4, 1), (5, 1.5), (3, 0.5), (4, 4)]


def deg(tonic, d, scale=AEOLIAN):
    o, i = divmod(d, len(scale))
    return tonic + 12 * o + scale[i]


class Score:
    def __init__(self, bpm, bars, beats=4):
        self.bpm = bpm
        self.bars = bars
        self.beats = beats
        self.ev = []  # (t_beats, chan, key, vel, dur_beats)
        self.cc = []  # (t_beats, chan, cc, value)
        self.prog = {}
        self.vol = {}

    @property
    def length_beats(self):
        return self.bars * self.beats

    def sec(self, b):
        return b * 60.0 / self.bpm

    def inst(self, chan, prog, vol=100, pan=64, drums=False):
        self.prog[chan] = (prog, drums)
        self.vol[chan] = (vol, pan)

    def note(self, t, chan, key, vel, dur):
        if 0 <= key < 128:
            self.ev.append((t, chan, int(key), int(max(1, min(127, vel))), dur))

    def swell(self, t0, t1, chan, v0, v1, steps=12):
        for i in range(steps + 1):
            k = i / steps
            self.cc.append((t0 + (t1 - t0) * k, chan, 11, int(v0 + (v1 - v0) * (0.5 - 0.5 * math.cos(math.pi * k)))))


def chords_for(prog_degs, tonic):
    """triads (three keys) for each scale degree in the progression"""
    out = []
    for d in prog_degs:
        out.append([deg(tonic, d), deg(tonic, d + 2), deg(tonic, d + 4)])
    return out


def theme_line(sc, chan, t0, tonic, vel=88, transpose=0, rhythm=1.0, ornament=True, rnd=None, phrase=None, sustain=0.95):
    t = t0
    for i, (d, b) in enumerate(phrase or THEME):
        key = deg(tonic, d) + transpose
        dur = b * rhythm
        if ornament and rnd and b >= 1.5 and rnd.random() < 0.35:
            # shakuhachi-style grace: a quick upper neighbour before the long note
            sc.note(t, chan, key + 2, vel - 20, 0.12 * rhythm)
            sc.note(t + 0.12 * rhythm, chan, key, vel, dur * sustain - 0.12 * rhythm)
        else:
            sc.note(t, chan, key, vel + (6 if i % 4 == 0 else 0), dur * sustain)
        t += dur
    return t


def phrase_len(phrase=None):
    return sum(b for _, b in (phrase or THEME))


# ------------------------------------------------------------------------------------------ cue builders

def explore(name, tonic, bpm, palette, seed, mood='village'):
    """calm exploration loop: pad + koto/harp arpeggios + the theme on a solo instrument, sparse bells"""
    rnd = random.Random(seed)
    sc = Score(bpm, 32)
    sc.inst(0, P[palette.get('pad', 'slow_strings')], 82, 64)
    sc.inst(1, P[palette.get('arp', 'koto')], 78, 48)
    sc.inst(2, P[palette.get('lead', 'shakuhachi')], 92, 72)
    sc.inst(3, P['contrabass'], 84, 64)
    sc.inst(4, P[palette.get('sparkle', 'bells')], 52, 90)
    sc.inst(5, P[palette.get('pad2', 'choir')], 60, 40)
    prog = palette.get('prog', [0, 5, 3, 4, 0, 5, 6, 4])
    ch = chords_for(prog, tonic - 12)
    B = sc.beats
    for bar in range(sc.bars):
        c = ch[bar % len(ch)]
        t = bar * B
        # pad: chord in close voicing, swelling
        for k in c:
            sc.note(t, 0, k + 12, 70, B * 0.98)
        sc.swell(t, t + B, 0, 60, 100)
        if bar % 2 == 0:
            for k in c[:2]:
                sc.note(t, 5, k + 24, 55, B * 2 * 0.98)
        # bass on 1 (and 3 now and then)
        sc.note(t, 3, c[0] - 12, 80, B * 0.9 if bar % 2 else B * 0.48)
        if bar % 2 == 0:
            sc.note(t + 2.5, 3, c[0] - 12, 60, 1.4)
        # arpeggio: gentle 8ths across chord tones and the in-scale colour notes
        pat = [0, 1, 2, 1, 3, 2, 1, 2] if mood != 'snow' else [0, None, 2, None, 1, None, 3, None]
        tones = c + [c[0] + 12]
        for i, p in enumerate(pat):
            if p is None or (mood == 'shrine' and rnd.random() < 0.2):
                continue
            sc.note(t + i * 0.5, 1, tones[p] + 12, 58 + rnd.randint(-6, 8) + (10 if i == 0 else 0), 0.9)
        # sparkle
        if rnd.random() < 0.35:
            sc.note(t + rnd.choice([1.5, 2.5, 3.5]), 4, deg(tonic, rnd.choice([7, 9, 11, 14])) + 12, 60, 2)
    # the theme twice (second time an octave down and freer)
    L = phrase_len()
    start = 4 * B
    theme_line(sc, 2, start, tonic, 86, rnd=rnd)
    theme_line(sc, 2, start + L + 4 * B, tonic, 80, transpose=-12 if mood == 'snow' else 0, rnd=rnd)
    return sc


def combat(name, tonic, bpm, palette, seed, heavy=False):
    """driving combat loop: string ostinato, taiko patterns, brass/horn stabs, the theme in fragments"""
    rnd = random.Random(seed)
    sc = Score(bpm, 16)
    sc.inst(0, P['strings'], 104, 56)
    sc.inst(1, P['cello'], 82, 70)
    sc.inst(2, P[palette.get('lead', 'horn')], 108, 64)
    sc.inst(3, P['contrabass'], 72, 64)
    sc.inst(4, P['taiko'], 100, 60)
    sc.inst(5, P['timpani'], 96, 64)
    sc.inst(6, P[palette.get('color', 'shamisen')], 76, 84)
    sc.inst(7, P['choir'], 78 if heavy else 0, 64)
    sc.inst(9, 0, 100, 64, drums=True)
    prog = palette.get('prog', [0, 0, 5, 6, 0, 0, 3, 4])
    ch = chords_for(prog, tonic - 12)
    B = sc.beats
    for bar in range(sc.bars):
        c = ch[bar % len(ch)]
        t = bar * B
        # ostinato 16ths: root-root-fifth-root with accents (cello + strings)
        figure = [0, 0, 2, 0, 1, 0, 2, 0] * 2
        for i, f in enumerate(figure):
            v = 92 if i % 4 == 0 else 70
            sc.note(t + i * 0.25, 1, c[f] if f < 3 else c[0], v, 0.22)
            if i % 2 == 0:
                sc.note(t + i * 0.25, 0, c[f] + 12, v - 10, 0.22)
        sc.note(t, 3, c[0] - 12, 100, 1.8)
        sc.note(t + 2, 3, c[0] - 12, 90, 1.8)
        # taiko: big hits on 1 and the 'and' of 2, rolls into every 4th bar
        k = tonic - 24 + 12
        for b, v in ((0, 120), (1.5, 100), (2, 110), (3.0, 90), (3.5, 96)):
            sc.note(t + b, 4, k, v, 0.5)
        if bar % 4 == 3:
            for i in range(8):
                sc.note(t + 2 + i * 0.25, 4, k + 7, 70 + i * 6, 0.25)
        # GM toms + cymbal accents
        sc.note(t, 9, 41, 100, 0.5)
        sc.note(t + 2, 9, 43, 90, 0.5)
        if bar % 4 == 0:
            sc.note(t, 9, 49, 90 if not heavy else 110, 2)
        if heavy:
            sc.note(t, 5, c[0] - 12, 110, 0.9)
            sc.note(t + 1.5, 5, c[0] - 12, 90, 0.5)
            for kk in c:
                sc.note(t, 7, kk + 12, 80, B * 0.95)
        # shamisen / colour plucks on the off-beats
        if rnd.random() < 0.6:
            for i in (1, 3):
                sc.note(t + i + 0.5, 6, deg(tonic, rnd.choice([4, 6, 7, 8])), 70, 0.4)
    # theme fragments on brass, twice (first half of the theme, augmented in heavy cues)
    frag = THEME[:8]
    rh = 1.0 if not heavy else 1.0
    theme_line(sc, 2, 4 * B, tonic, 96, rhythm=rh, ornament=False, phrase=frag, sustain=0.9)
    theme_line(sc, 2, 12 * B, tonic, 100, transpose=0 if not heavy else 12, rhythm=rh, ornament=False, phrase=THEME[8:15], sustain=0.9)
    return sc


def slow(name, tonic, bpm, palette, seed, bars=24, hopeful=False):
    """title / sorrow / ending: the theme slowly, harp and strings, choir at the climax"""
    rnd = random.Random(seed)
    sc = Score(bpm, bars)
    sc.inst(0, P['slow_strings'], 86, 64)
    sc.inst(1, P['harp'], 80, 44)
    sc.inst(2, P[palette.get('lead', 'shakuhachi')], 90, 76)
    sc.inst(3, P['contrabass'], 80, 64)
    sc.inst(4, P['choir'], 66, 64)
    sc.inst(5, P['cello'], 82, 52)
    prog = palette.get('prog', [0, 5, 3, 4, 0, 5, 6, 0] if not hopeful else [5, 3, 0, 4, 5, 3, 6, 0])
    scale = AEOLIAN
    ch = chords_for(prog, tonic - 12)
    B = sc.beats
    for bar in range(sc.bars):
        c = ch[bar % len(ch)]
        t = bar * B
        for k in c:
            sc.note(t, 0, k + 12, 62, B * 0.99)
        sc.swell(t, t + B, 0, 55, 95)
        sc.note(t, 3, c[0] - 12, 70, B * 0.98)
        if bar >= bars // 2:
            for k in c:
                sc.note(t, 4, k + 24, 58, B * 0.98)
            sc.swell(t, t + B, 4, 50, 92)
        # harp: rolled chord, then a rising figure
        for i, k in enumerate(c + [c[0] + 12, c[1] + 12]):
            sc.note(t + i * 0.12, 1, k + 12, 60 - i * 3, 3)
        if bar % 2 == 1:
            for i, k in enumerate([c[0] + 24, c[1] + 24, c[2] + 24]):
                sc.note(t + 2 + i * 0.5, 1, k, 52, 1.5)
        sc.note(t + 2, 5, c[2] - 12, 60, 2)
    L = phrase_len()
    theme_line(sc, 2, 2 * B, tonic, 84, rhythm=1.25 if not hopeful else 1.15, rnd=rnd)
    _ = scale
    return sc


# chapter palettes: key (MIDI tonic of the theme), tempo, instruments
CUES = {
    'title': lambda: slow('title', 62, 66, {'lead': 'shakuhachi'}, 1, bars=28),
    'sorrow': lambda: slow('sorrow', 60, 54, {'lead': 'cello', 'prog': [0, 3, 5, 4, 0, 6, 3, 4]}, 2, bars=20),
    'ending': lambda: slow('ending', 62, 70, {'lead': 'flute'}, 3, bars=32, hopeful=True),
    # Chapter One: Hinoka (shakuhachi, koto, strings)
    'c1_explore': lambda: explore('c1_explore', 62, 76, {'arp': 'koto', 'lead': 'shakuhachi', 'pad': 'slow_strings'}, 11),
    'c1_combat': lambda: combat('c1_combat', 62, 132, {'lead': 'horn', 'color': 'shamisen'}, 12),
    'c1_boss': lambda: combat('c1_boss', 62, 138, {'lead': 'brass', 'color': 'koto', 'prog': [0, 0, 5, 5, 3, 3, 4, 4]}, 13, heavy=True),
    # Chapter Two: the Drowned Shrine (harp, choir, flute; rain)
    'c2_explore': lambda: explore('c2_explore', 64, 68, {'arp': 'harp', 'lead': 'flute', 'pad': 'choir_pad', 'pad2': 'voice_oohs', 'sparkle': 'celesta', 'prog': [0, 3, 5, 4, 0, 6, 5, 4]}, 21, mood='shrine'),
    'c2_combat': lambda: combat('c2_combat', 64, 128, {'lead': 'horn', 'color': 'koto', 'prog': [0, 0, 3, 4, 0, 0, 5, 4]}, 22),
    'c2_boss': lambda: combat('c2_boss', 64, 136, {'lead': 'choir', 'color': 'harp', 'prog': [0, 5, 3, 4, 0, 5, 6, 4]}, 23, heavy=True),
    # Chapter Three: Frostwake (bells, celesta, sparse)
    'c3_explore': lambda: explore('c3_explore', 59, 60, {'arp': 'celesta', 'lead': 'pan', 'pad': 'halo_pad', 'pad2': 'choir', 'sparkle': 'bells', 'prog': [0, 5, 0, 6, 0, 3, 4, 0]}, 31, mood='snow'),
    'c3_combat': lambda: combat('c3_combat', 59, 126, {'lead': 'horn', 'color': 'celesta'}, 32),
    'c3_boss': lambda: combat('c3_boss', 59, 134, {'lead': 'brass', 'color': 'bells', 'prog': [0, 0, 6, 6, 5, 5, 4, 4]}, 33, heavy=True),
    # Chapter Four: the Heart Forge (taiko, low brass)
    'c4_explore': lambda: explore('c4_explore', 57, 72, {'arp': 'shamisen', 'lead': 'trombone', 'pad': 'warm_pad', 'pad2': 'choir', 'sparkle': 'timpani', 'prog': [0, 1, 0, 6, 0, 1, 3, 4]}, 41),
    'c4_combat': lambda: combat('c4_combat', 57, 140, {'lead': 'trombone', 'color': 'shamisen', 'prog': [0, 0, 1, 1, 0, 0, 6, 4]}, 42),
    'c4_boss': lambda: combat('c4_boss', 57, 144, {'lead': 'brass', 'color': 'shamisen', 'prog': [0, 1, 0, 6, 0, 1, 5, 4]}, 43, heavy=True),
    # Chapter Five: the Hollow Crown (everything)
    'c5_explore': lambda: explore('c5_explore', 60, 64, {'arp': 'harp', 'lead': 'shakuhachi', 'pad': 'choir', 'pad2': 'slow_strings', 'sparkle': 'bells', 'prog': [0, 5, 3, 6, 0, 5, 1, 4]}, 51, mood='shrine'),
    'c5_combat': lambda: combat('c5_combat', 60, 136, {'lead': 'brass', 'color': 'koto'}, 52, heavy=True),
    'c5_boss': lambda: combat('c5_boss', 60, 148, {'lead': 'choir', 'color': 'shamisen', 'prog': [0, 0, 5, 5, 6, 6, 4, 4]}, 53, heavy=True),
}
LOOP = {k: not k in ('ending', 'sorrow') for k in CUES}


# ------------------------------------------------------------------------------------------ render

def render(sc, tail=6.0):
    synth = tsf.Synth(gain=-6, samplerate=SR)
    sf = synth.sfload(SF)
    for chan, (prog, drums) in sc.prog.items():
        synth.program_select(chan, sf, 128 if drums else 0, prog, is_drums=drums)
        vol, pan = sc.vol[chan]
        synth.control_change(chan, 7, vol)
        synth.control_change(chan, 10, pan)
        synth.control_change(chan, 11, 110)
        synth.control_change(chan, 91, 30)
    events = []
    for t, chan, key, vel, dur in sc.ev:
        events.append((sc.sec(t), 1, chan, key, vel))
        events.append((sc.sec(t + dur), 0, chan, key, 0))
    for t, chan, cc, v in sc.cc:
        events.append((sc.sec(t), 2, chan, cc, v))
    events.sort(key=lambda e: (e[0], e[1]))
    total = sc.sec(sc.length_beats) + tail
    n = int(total * SR)
    out = np.zeros((n, 2), np.float32)
    pos = 0
    for t, kind, chan, a, b in events + [(total, -1, 0, 0, 0)]:
        s = min(n, int(t * SR))
        if s > pos:
            buf = synth.generate(s - pos)
            out[pos:s] = np.frombuffer(buf, dtype=np.float32).reshape(-1, 2)
            pos = s
        if kind == 1:
            synth.noteon(chan, a, b)
        elif kind == 0:
            synth.noteoff(chan, a)
        elif kind == 2:
            synth.control_change(chan, a, b)
    return out


def reverb(x, seconds=2.6, mix=0.28, seed=0):
    """stereo convolution with decaying, filtered noise (a hall), plus early reflections"""
    rng = np.random.default_rng(seed)
    L = int(seconds * SR)
    t = np.arange(L) / SR
    env = np.exp(-t * 6.9 / seconds)
    ir = np.zeros((L, 2), np.float32)
    for c in range(2):
        nz = rng.standard_normal(L) * env
        # darken the tail: one-pole lowpass whose cutoff falls with time
        y = np.zeros(L)
        a = 0.0
        for i in range(0, L, 1024):
            k = 0.35 + 0.5 * (1 - min(1, i / L * 2))
            seg = nz[i:i + 1024]
            o = np.empty_like(seg)
            for j, v in enumerate(seg):
                a += k * (v - a)
                o[j] = a
            y[i:i + 1024] = o
        ir[:, c] = y
        for d, g in ((0.011, 0.5), (0.019, 0.35), (0.031, 0.28), (0.047, 0.2)):
            ir[int(d * SR * (1.1 if c else 1.0)), c] += g
    ir /= np.sqrt((ir ** 2).sum(axis=0)) + 1e-9
    wet = np.zeros_like(x)
    nfft = 1 << int(np.ceil(np.log2(len(x) + L)))
    for c in range(2):
        X = np.fft.rfft(x[:, c], nfft)
        H = np.fft.rfft(ir[:, c], nfft)
        wet[:, c] = np.fft.irfft(X * H, nfft)[:len(x)]
    return x * (1 - mix) + wet * mix * 1.6


def master(x):
    # gentle compression (RMS follower) then normalise to -1 dBFS peak
    rms = np.sqrt(np.convolve((x ** 2).mean(axis=1), np.ones(2048) / 2048, mode='same')) + 1e-6
    gain = np.minimum(1.0, (0.18 / rms) ** 0.35)
    x = x * gain[:, None]
    peak = np.abs(x).max() + 1e-9
    return x * (0.89 / peak)


def build(name):
    sc = CUES[name]()
    loop = LOOP[name]
    tail = 6.0
    x = render(sc, tail)
    x = reverb(x, 3.0 if name in ('title', 'sorrow', 'ending') or 'explore' in name else 2.2, 0.32 if 'explore' in name else 0.24, seed=len(name))
    if loop:
        # fold the tail onto the start: the loop is exactly length_beats long and seamless
        n = int(sc.sec(sc.length_beats) * SR)
        body, rest = x[:n].copy(), x[n:]
        body[:len(rest)] += rest
        x = body
    else:
        # fade the end
        f = int(4 * SR)
        x[-f:] *= np.linspace(1, 0, f)[:, None]
    x = master(x)
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, name + '.wav')
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    import wave
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    mp3 = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', mp3], check=True)
    os.remove(wav)
    print('cue', name, f'{len(x) / SR:.1f}s', 'loop' if loop else '', os.path.getsize(mp3) // 1024, 'KB')
    return {'loop': loop, 'length': len(x) / SR}


if __name__ == '__main__':
    import json
    names = sys.argv[1:] or list(CUES)
    mp = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mp)) if os.path.exists(mp) else {}
    for n in names:
        man[n] = build(n)
    json.dump(man, open(mp, 'w'), indent=1)
