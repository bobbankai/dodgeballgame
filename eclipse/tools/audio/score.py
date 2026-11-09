"""Composes and renders the adaptive score (General MIDI through FluidSynth + FluidR3_GM).

  /opt/bvenv/bin/python eclipse/tools/audio/score.py [piece ...]

Each area's music is a set of stems of the same length and tempo, written to loop: the game plays
them together and fades layers in and out (audio/Audio.ts). Stems are rendered separately, their
reverb tails wrapped round onto the start so the loop has no seam, normalised, and encoded to Ogg.

  ashen       D minor, 72 bpm, 24 bars. explore_pad (strings + choir), explore_theme (cello and horn
              over harp), combat_drums (taiko, timpani, low string ostinato), combat_brass (stabs and
              a falling horn call).
  ignaroth    The Burning King: D phrygian, 96 bpm, 32 bars. boss_orch (brass theme over driving
              strings), boss_choir (choir and percussion).
  drowned     E dorian/aeolian, 66 bpm, 24 bars, rolling triplets like a swell. explore_pad (strings,
              wordless choir, warm pad), explore_theme (harp and celesta in triplets under an English
              horn lament), combat_drums (taiko 3+3+2, timpani, cello ostinato), combat_brass (horns).
  sky         D lydian, 76 bpm, 24 bars: open-voiced strings and choir, harp and a flute leaping high.
  vaeltris    The Storm Unbound: B minor, 120 bpm, 32 bars, galloping strings under brass; choir and drums.
  thaloryn    The Drowned King: E phrygian, 84 bpm, 32 bars. boss_orch (low brass theme in wide
              intervals over tremolo strings and a rolling bass), boss_choir (choir and percussion).
"""
import json
import os
import subprocess
import sys
import tempfile

import mido
import numpy as np
from scipy.io import wavfile

SR = 48000
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'audio')
OUT = os.path.join(ROOT, 'music')
os.makedirs(OUT, exist_ok=True)
TPB = 480

GM = {'strings': 48, 'strings2': 49, 'choir': 52, 'voice': 53, 'cello': 42, 'contrabass': 43, 'harp': 46, 'horn': 60,
      'trombone': 57, 'brass': 61, 'tuba': 58, 'timpani': 47, 'taiko': 116, 'pizz': 45, 'tremolo': 44, 'bells': 14, 'piano': 0,
      'flute': 73, 'ehorn': 69, 'celesta': 8, 'pad_warm': 89}

NOTE = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}


def n(name, octave):
    return 12 * (octave + 1) + NOTE[name]


class Stem:
    """One stem: several instrument tracks (channels) written in beats."""

    def __init__(self, bpm, bars):
        self.bpm = bpm
        self.bars = bars
        self.tracks = []

    def track(self, prog, vol=100, pan=64, channel=None):
        ch = channel if channel is not None else len(self.tracks)
        if ch == 9:
            ch = 10
        t = {'prog': prog, 'ch': ch, 'events': [], 'vol': vol, 'pan': pan}
        self.tracks.append(t)
        return t

    def drums(self, vol=110):
        t = {'prog': 0, 'ch': 9, 'events': [], 'vol': vol, 'pan': 64}
        self.tracks.append(t)
        return t

    @staticmethod
    def note(t, beat, length, pitch, vel=90):
        t['events'].append((beat, length, pitch, vel))

    def chord(self, t, beat, length, pitches, vel=80):
        for p in pitches:
            self.note(t, beat, length, p, vel)

    def write(self, path):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        meta = mido.MidiTrack()
        meta.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(self.bpm), time=0))
        mid.tracks.append(meta)
        for t in self.tracks:
            tr = mido.MidiTrack()
            ch = t['ch']
            tr.append(mido.Message('program_change', program=t['prog'], channel=ch, time=0))
            tr.append(mido.Message('control_change', control=7, value=t['vol'], channel=ch, time=0))
            tr.append(mido.Message('control_change', control=10, value=t['pan'], channel=ch, time=0))
            tr.append(mido.Message('control_change', control=91, value=70, channel=ch, time=0))
            evs = []
            for beat, length, pitch, vel in t['events']:
                evs.append((int(beat * TPB), 1, pitch, vel))
                evs.append((int((beat + length) * TPB) - 1, 0, pitch, 0))
            evs.sort(key=lambda e: (e[0], e[1]))
            now = 0
            for tick, on, pitch, vel in evs:
                msg = 'note_on' if on else 'note_off'
                tr.append(mido.Message(msg, note=int(pitch), velocity=int(vel), channel=ch, time=max(0, tick - now)))
                now = max(now, tick)
            mid.tracks.append(tr)
        mid.save(path)


def render(stem, name, gain=0.6):
    """MIDI -> wav (FluidSynth) -> wrap the reverb tail onto the head -> normalise -> ogg."""
    loop_s = stem.bars * 4 * 60.0 / stem.bpm
    with tempfile.TemporaryDirectory() as d:
        mpath = os.path.join(d, 'x.mid')
        wpath = os.path.join(d, 'x.wav')
        stem.write(mpath)
        subprocess.run(['fluidsynth', '-ni', '-g', str(gain), '-r', str(SR), '-F', wpath,
                        '-o', 'synth.reverb.active=1', '-o', 'synth.reverb.room-size=0.85', '-o', 'synth.reverb.width=1',
                        '-o', 'synth.reverb.level=0.7', '-o', 'synth.chorus.active=0', SF2, mpath], check=True, capture_output=True)
        sr, x = wavfile.read(wpath)
    x = x.astype(np.float32) / 32768.0
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    L = int(loop_s * SR)
    out = np.zeros((L, 2), np.float32)
    out[: min(L, len(x))] = x[:L]
    tail = x[L:]
    if len(tail):
        k = min(len(tail), L)
        out[:k] += tail[:k]
    peak = np.abs(out).max() + 1e-9
    out = out / peak * 0.85
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        wavfile.write(tf.name, SR, (out * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tf.name, '-c:a', 'libvorbis', '-q:a', '4',
                        os.path.join(OUT, f'{name}.ogg')], check=True)
        os.unlink(tf.name)
    print('rendered', name, round(loop_s, 1), 's')
    return f'music/{name}.ogg'


# ============================================================================== Chapter One
def ashen():
    bpm, bars = 72, 24
    # i - VI - iv - V | i - bII - VI - V | i - VI - III - VII   (two bars each)
    prog = [('D', 'm'), ('Bb', 'M'), ('G', 'm'), ('A', 'M'),
            ('D', 'm'), ('Eb', 'M'), ('Bb', 'M'), ('A', 'M'),
            ('D', 'm'), ('Bb', 'M'), ('F', 'M'), ('C', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    # ---------------------------------------------------------------- explore_pad
    s = Stem(bpm, bars)
    st = s.track(GM['strings'], 92, 54)
    cb = s.track(GM['contrabass'], 96, 64)
    ch = s.track(GM['choir'], 70, 74)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        # voice-led string chord: root low, third and fifth spread
        s.chord(st, b, 7.9, [tri[0], tri[1] + 12, tri[2], tri[0] + 12], 62 + 6 * (i % 3 == 0))
        s.note(cb, b, 7.9, n(root, 2), 80)
        if i % 4 in (1, 3):
            s.chord(ch, b + 2, 5.8, [tri[1] + 12, tri[2] + 12], 55)
    stems['explore_pad'] = render(s, 'ashen_explore_pad', 0.7)
    # ---------------------------------------------------------------- explore_theme
    s = Stem(bpm, bars)
    harp = s.track(GM['harp'], 80, 40)
    cello = s.track(GM['cello'], 100, 70)
    horn = s.track(GM['horn'], 88, 84)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 4)
        arp = [tri[0], tri[1], tri[2], tri[1] + 12, tri[2], tri[1]]
        for k in range(8):
            s.note(harp, b + k, 0.95, arp[k % len(arp)] - (12 if k % 4 == 0 else 0), 48 + (k == 0) * 14)
    # the theme: a lament that climbs and falls back (D minor, with the flat second for the god's menace)
    theme = [  # (beat, length, note, octave)
        (0, 3, 'A', 3), (3, 1, 'Bb', 3), (4, 2, 'A', 3), (6, 2, 'F', 3), (8, 4, 'D', 3), (12, 2, 'E', 3), (14, 2, 'F', 3),
        (16, 3, 'G', 3), (19, 1, 'A', 3), (20, 2, 'Bb', 3), (22, 2, 'A', 3), (24, 6, 'E', 3), (30, 2, 'Eb', 3),
        (32, 3, 'D', 3), (35, 1, 'Eb', 3), (36, 4, 'D', 3), (40, 2, 'Bb', 2), (42, 2, 'C', 3), (44, 4, 'D', 3),
        (48, 3, 'G', 3), (51, 1, 'F', 3), (52, 4, 'E', 3), (56, 8, 'Db', 3),
    ]
    for beat, length, name, octv in theme:
        s.note(cello, 64 + beat, length - 0.05, n(name, octv), 82)
    horn_call = [(0, 2, 'D', 4), (2, 1, 'F', 4), (3, 1, 'E', 4), (4, 6, 'D', 4), (10, 2, 'A', 3), (12, 4, 'Bb', 3)]
    for beat, length, name, octv in horn_call:
        s.note(horn, 152 + beat, length - 0.05, n(name, octv), 70)
    stems['explore_theme'] = render(s, 'ashen_explore_theme', 0.7)
    # ---------------------------------------------------------------- combat_drums
    s = Stem(bpm, bars)
    taiko = s.track(GM['taiko'], 110, 64)
    timp = s.track(GM['timpani'], 104, 60)
    low = s.track(GM['strings2'], 96, 64)
    for bar in range(bars):
        b = bar * 4
        pat = [0, 1.5, 2, 3, 3.5] if bar % 4 != 3 else [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75]
        for k, off in enumerate(pat):
            s.note(taiko, b + off, 0.4, n('D', 2) + (5 if k == 0 else 0), 118 if off == 0 else 88)
        root = prog[(bar // 2) % len(prog)][0]
        s.note(timp, b, 0.9, n(root, 2), 100)
        s.note(timp, b + 2.5, 0.4, n(root, 2), 80)
        for k in range(8):
            # driving spiccato eighths on the chord root, accent on the offbeat pattern
            s.note(low, b + k * 0.5, 0.3, n(root, 2) + (12 if k in (3, 6) else 0), 100 if k in (0, 3, 6) else 72)
    stems['combat_drums'] = render(s, 'ashen_combat_drums', 0.75)
    # ---------------------------------------------------------------- combat_brass
    s = Stem(bpm, bars)
    brass = s.track(GM['brass'], 104, 60)
    tbn = s.track(GM['trombone'], 100, 76)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        s.chord(brass, b, 0.6, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 108)
        s.chord(brass, b + 3, 0.4, [tri[0] + 12, tri[2] + 12], 96)
        s.chord(brass, b + 4.5, 1.4, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 100)
        if i % 2 == 1:
            for k, (dur, step) in enumerate([(1, 0), (0.5, -1), (0.5, -2), (2, -4)]):
                s.note(tbn, b + 4 + sum(x[0] for x in [(1, 0), (0.5, -1), (0.5, -2), (2, -4)][:k]), dur - 0.05, n(root, 2) + 12 + step, 104)
    stems['combat_brass'] = render(s, 'ashen_combat_brass', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


# ============================================================================== Ignaroth
def ignaroth():
    bpm, bars = 96, 32
    # D phrygian: the flat second (Eb) is his. i - bII - i - bVII | i - bII - bVI - V
    prog = [('D', 'm'), ('Eb', 'M'), ('D', 'm'), ('C', 'M'), ('D', 'm'), ('Eb', 'M'), ('Bb', 'M'), ('A', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    s = Stem(bpm, bars)
    trem = s.track(GM['tremolo'], 96, 50)
    lo = s.track(GM['contrabass'], 104, 64)
    brass = s.track(GM['brass'], 110, 70)
    horn = s.track(GM['horn'], 104, 84)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 3)
        s.chord(trem, b, 3.95, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 84)
        for k in range(8):
            s.note(lo, b + k * 0.5, 0.35, n(root, 1) + (12 if k % 2 else 0), 110 if k % 2 == 0 else 86)
    theme = [(0, 1.5, 'D', 4), (1.5, 0.5, 'Eb', 4), (2, 2, 'D', 4), (4, 1, 'C', 4), (5, 1, 'Bb', 3), (6, 2, 'A', 3),
             (8, 3, 'D', 4), (11, 1, 'F', 4), (12, 2, 'Eb', 4), (14, 2, 'D', 4),
             (16, 1.5, 'G', 4), (17.5, 0.5, 'F', 4), (18, 2, 'Eb', 4), (20, 2, 'D', 4), (22, 2, 'Eb', 4), (24, 8, 'D', 4)]
    for rep in (0, 64):
        for beat, length, name, octv in theme:
            s.note(brass, 32 + rep + beat, length - 0.05, n(name, octv), 112)
            s.note(horn, 32 + rep + beat, length - 0.05, n(name, octv - 1), 100)
    stems['boss_orch'] = render(s, 'ignaroth_orch', 0.65)
    s = Stem(bpm, bars)
    choir = s.track(GM['choir'], 104, 64)
    taiko = s.track(GM['taiko'], 118, 64)
    timp = s.track(GM['timpani'], 110, 60)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 4)
        if bar % 2 == 0:
            s.chord(choir, b, 7.9, [tri[0] - 12, tri[0], tri[1], tri[2]], 92 if bar >= 8 else 70)
        for off in (0, 0.75, 1.5, 2, 2.5, 3, 3.5):
            s.note(taiko, b + off, 0.3, n('D', 2), 124 if off in (0, 2) else 92)
        s.note(timp, b, 0.6, n(root, 2), 112)
        s.note(timp, b + 1.5, 0.3, n(root, 2) + 7, 92)
    stems['boss_choir'] = render(s, 'ignaroth_choir', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


# ============================================================================== Chapter Two
def drowned():
    bpm, bars = 66, 24
    # Em - C - D - Bm | Em - A (the dorian sixth) - C - D | Am - Em - C - B   (two bars each)
    prog = [('E', 'm'), ('C', 'M'), ('D', 'M'), ('B', 'm'),
            ('E', 'm'), ('A', 'M'), ('C', 'M'), ('D', 'M'),
            ('A', 'm'), ('E', 'm'), ('C', 'M'), ('B', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    # ---------------------------------------------------------------- explore_pad
    s = Stem(bpm, bars)
    st = s.track(GM['strings'], 90, 50)
    cb = s.track(GM['contrabass'], 92, 64)
    ch = s.track(GM['voice'], 72, 78)
    pad = s.track(GM['pad_warm'], 60, 64)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        s.chord(st, b, 7.9, [tri[0], tri[2], tri[1] + 12, tri[0] + 12], 58 + 8 * (i % 4 == 0))
        s.note(cb, b, 7.9, n(root, 2), 76)
        s.chord(pad, b, 7.9, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 46)
        if i % 2 == 1:
            # the drowned choir: a slow rising sigh on the third and fifth
            s.note(ch, b + 1, 3, tri[1] + 12, 52)
            s.note(ch, b + 4, 3.8, tri[2] + 12, 56)
    stems['explore_pad'] = render(s, 'drowned_explore_pad', 0.7)
    # ---------------------------------------------------------------- explore_theme
    s = Stem(bpm, bars)
    harp = s.track(GM['harp'], 84, 38)
    cel = s.track(GM['celesta'], 64, 90)
    eh = s.track(GM['ehorn'], 100, 66)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        # rolling triplets, rising and falling like a swell
        roll = [tri[0], tri[2], tri[1] + 12, tri[2] + 12, tri[1] + 12, tri[2]]
        for k in range(24):
            s.note(harp, b + k / 3, 0.6, roll[k % 6] + (12 if (k // 6) % 2 else 0), 46 + 12 * (k % 6 == 0))
        if i % 4 == 2:
            for k, p in enumerate([tri[2] + 24, tri[1] + 24, tri[0] + 24]):
                s.note(cel, b + 4 + k * 0.67, 1.5, p, 52)
    # the lament: long, falling phrases, answered a step higher
    theme = [
        (0, 3, 'B', 4), (3, 1, 'A', 4), (4, 2, 'G', 4), (6, 2, 'E', 4), (8, 6, 'Gb', 4), (14, 2, 'D', 4),
        (16, 3, 'E', 4), (19, 1, 'Gb', 4), (20, 2, 'G', 4), (22, 2, 'B', 4), (24, 4, 'A', 4), (28, 4, 'Db', 5),
        (32, 3, 'B', 4), (35, 1, 'C', 5), (36, 2, 'B', 4), (38, 2, 'A', 4), (40, 6, 'G', 4), (46, 2, 'Gb', 4),
        (48, 3, 'E', 4), (51, 1, 'D', 4), (52, 4, 'E', 4), (56, 8, 'Eb', 4),
    ]
    for beat, length, name, octv in theme:
        s.note(eh, 32 + beat, length - 0.05, n(name, octv), 80)
    stems['explore_theme'] = render(s, 'drowned_explore_theme', 0.7)
    # ---------------------------------------------------------------- combat_drums
    s = Stem(bpm, bars)
    taiko = s.track(GM['taiko'], 112, 64)
    timp = s.track(GM['timpani'], 104, 58)
    low = s.track(GM['cello'], 100, 70)
    for bar in range(bars):
        b = bar * 4
        root = prog[(bar // 2) % len(prog)][0]
        # 3+3+2 in eighths: a surge, a surge, a break
        pat = [0, 1.5, 3] if bar % 4 != 3 else [0, 0.5, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75]
        for off in pat:
            s.note(taiko, b + off, 0.4, n('E', 2), 120 if off == 0 else 92)
        s.note(timp, b, 0.9, n(root, 2), 100)
        s.note(timp, b + 3, 0.4, n(root, 2) + 7, 84)
        for k in range(8):
            s.note(low, b + k * 0.5, 0.32, n(root, 2) + (7 if k in (3, 6) else 0), 104 if k in (0, 3, 6) else 74)
    stems['combat_drums'] = render(s, 'drowned_combat_drums', 0.75)
    # ---------------------------------------------------------------- combat_brass
    s = Stem(bpm, bars)
    horn = s.track(GM['horn'], 106, 56)
    tbn = s.track(GM['trombone'], 100, 76)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        s.chord(horn, b, 1.4, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 104)
        s.chord(horn, b + 3, 0.9, [tri[0] + 12, tri[2] + 12], 92)
        if i % 2 == 0:
            for k, (beat, length, step) in enumerate([(4, 1.5, 7), (5.5, 0.5, 5), (6, 2, 3)]):
                s.note(tbn, b + beat, length - 0.05, n(root, 2) + 12 + step - (0 if kind == 'm' else 1), 104)
    stems['combat_brass'] = render(s, 'drowned_combat_brass', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


# ============================================================================== Thaloryn
def thaloryn():
    bpm, bars = 84, 32
    # E phrygian: the flat second (F) is the undertow. i - bII - i - bVII | i - bII - bVI - V
    prog = [('E', 'm'), ('F', 'M'), ('E', 'm'), ('D', 'M'), ('E', 'm'), ('F', 'M'), ('C', 'M'), ('B', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    s = Stem(bpm, bars)
    trem = s.track(GM['tremolo'], 94, 48)
    lo = s.track(GM['contrabass'], 106, 64)
    brass = s.track(GM['trombone'], 112, 70)
    tuba = s.track(GM['tuba'], 104, 64)
    horn = s.track(GM['horn'], 100, 86)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 3)
        s.chord(trem, b, 3.95, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 80)
        # a rolling dotted bass: the sea heaving under him
        for off, dur, up in [(0, 0.7, 0), (0.75, 0.25, 12), (1, 0.5, 7), (1.5, 0.5, 0), (2, 0.7, 0), (2.75, 0.25, 12), (3, 1, 7)]:
            s.note(lo, b + off, dur - 0.05, n(root, 1) + up, 110 if off in (0, 2) else 86)
    # the theme: wide and slow, like something vast turning over in deep water
    theme = [(0, 2, 'E', 3), (2, 2, 'B', 3), (4, 1.5, 'C', 4), (5.5, 0.5, 'B', 3), (6, 2, 'A', 3),
             (8, 3, 'G', 3), (11, 1, 'F', 3), (12, 4, 'E', 3),
             (16, 2, 'E', 3), (18, 2, 'C', 4), (20, 1.5, 'D', 4), (21.5, 0.5, 'C', 4), (22, 2, 'B', 3), (24, 4, 'F', 3), (28, 4, 'E', 3)]
    for rep in (0, 64):
        for beat, length, name, octv in theme:
            s.note(brass, 32 + rep + beat, length - 0.05, n(name, octv), 112)
            s.note(tuba, 32 + rep + beat, length - 0.05, n(name, octv - 1), 100)
        for beat, length, name, octv in theme[:8]:
            s.note(horn, 48 + rep + beat, length - 0.05, n(name, octv + 1), 92)
    stems['boss_orch'] = render(s, 'thaloryn_orch', 0.65)
    s = Stem(bpm, bars)
    choir = s.track(GM['choir'], 104, 64)
    taiko = s.track(GM['taiko'], 118, 64)
    timp = s.track(GM['timpani'], 110, 58)
    bells = s.track(GM['bells'], 80, 80)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 4)
        if bar % 2 == 0:
            s.chord(choir, b, 7.9, [tri[0] - 12, tri[0], tri[1], tri[2]], 94 if bar >= 8 else 72)
        for off in (0, 1.5, 2, 3, 3.5):
            s.note(taiko, b + off, 0.35, n('E', 2), 124 if off in (0, 2) else 94)
        s.note(timp, b, 0.6, n(root, 2), 112)
        s.note(timp, b + 2.75, 0.3, n(root, 2) + 7, 92)
        if bar % 8 == 0:
            # the drowned temple's bell, tolling under the water
            s.note(bells, b, 6, n('E', 4), 84)
    stems['boss_choir'] = render(s, 'thaloryn_choir', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


# ============================================================================== Chapter Three
def sky():
    bpm, bars = 76, 24
    # D lydian (the raised fourth, G#, gives the height): D - E - Bm - A | D - E - G#dim - A | Bm - G - D - E
    prog = [('D', 'M'), ('E', 'M'), ('B', 'm'), ('A', 'M'), ('D', 'M'), ('E', 'M'), ('Gb', 'm'), ('A', 'M'),
            ('B', 'm'), ('G', 'M'), ('D', 'M'), ('E', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    s = Stem(bpm, bars)
    st = s.track(GM['strings'], 88, 52)
    cb = s.track(GM['contrabass'], 88, 64)
    ch = s.track(GM['choir'], 76, 76)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        # open voicing: root, fifth, tenth, the ninth on top for air
        s.chord(st, b, 7.9, [tri[0], tri[2], tri[1] + 12, tri[0] + 14], 60 + 6 * (i % 4 == 0))
        s.note(cb, b, 7.9, n(root, 2), 74)
        s.chord(ch, b + 1, 6.8, [tri[0] + 12, tri[2] + 12], 50 + 8 * (i % 2))
    stems['explore_pad'] = render(s, 'sky_explore_pad', 0.7)
    s = Stem(bpm, bars)
    harp = s.track(GM['harp'], 84, 40)
    fl = s.track(GM['flute'], 96, 74)
    bells = s.track(GM['bells'], 56, 90)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 4)
        arp = [tri[0], tri[2], tri[1] + 12, tri[2] + 12]
        for k in range(16):
            s.note(harp, b + k * 0.5, 0.45, arp[k % 4] - (12 if k % 8 == 0 else 0), 44 + 12 * (k % 8 == 0))
        if i % 4 == 0:
            s.note(bells, b, 4, n(root, 5), 50)
    # the flute: wide leaps that hang in the air
    theme = [(0, 2, 'A', 5), (2, 1, 'B', 5), (3, 1, 'Db', 6), (4, 4, 'E', 6), (8, 2, 'D', 6), (10, 2, 'B', 5), (12, 4, 'A', 5),
             (16, 3, 'Ab', 5), (19, 1, 'A', 5), (20, 2, 'B', 5), (22, 2, 'Db', 6), (24, 8, 'B', 5),
             (32, 2, 'Gb', 5), (34, 2, 'A', 5), (36, 4, 'D', 6), (40, 2, 'Db', 6), (42, 2, 'B', 5), (44, 4, 'Ab', 5), (48, 8, 'A', 5)]
    for beat, length, name, octv in theme:
        s.note(fl, 32 + beat, length - 0.05, n(name, octv), 78)
    stems['explore_theme'] = render(s, 'sky_explore_theme', 0.7)
    s = Stem(bpm, bars)
    taiko = s.track(GM['taiko'], 110, 64)
    timp = s.track(GM['timpani'], 104, 58)
    low = s.track(GM['strings2'], 98, 64)
    for bar in range(bars):
        b = bar * 4
        root = prog[(bar // 2) % len(prog)][0]
        pat = [0, 0.75, 1.5, 2, 3] if bar % 4 != 3 else [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75]
        for off in pat:
            s.note(taiko, b + off, 0.35, n('D', 2), 118 if off in (0, 2) else 88)
        s.note(timp, b, 0.8, n(root, 2), 98)
        for k in range(8):
            s.note(low, b + k * 0.5, 0.3, n(root, 3) + (7 if k % 4 == 2 else 0), 98 if k % 2 == 0 else 72)
    stems['combat_drums'] = render(s, 'sky_combat_drums', 0.75)
    s = Stem(bpm, bars)
    horn = s.track(GM['horn'], 106, 56)
    tbn = s.track(GM['trombone'], 98, 76)
    for i, (root, kind) in enumerate(prog):
        b = i * 8
        tri = triad(root, kind, 3)
        s.chord(horn, b, 1.6, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 102)
        s.chord(horn, b + 4, 1.0, [tri[0] + 12, tri[2] + 12], 92)
        if i % 2 == 1:
            s.note(tbn, b + 2, 1.9, n(root, 2) + 12, 100)
            s.note(tbn, b + 6, 1.9, n(root, 2) + 19, 100)
    stems['combat_brass'] = render(s, 'sky_combat_brass', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


def vaeltris():
    bpm, bars = 120, 32
    # B minor, storm-driven: i - VI - III - VII | i - VI - iv - V, with the lydian G# in the lines
    prog = [('B', 'm'), ('G', 'M'), ('D', 'M'), ('A', 'M'), ('B', 'm'), ('G', 'M'), ('E', 'm'), ('Gb', 'M')]

    def triad(root, kind, octave):
        r = n(root, octave)
        return [r, r + (3 if kind == 'm' else 4), r + 7]

    stems = {}
    s = Stem(bpm, bars)
    trem = s.track(GM['tremolo'], 96, 46)
    sp = s.track(GM['strings2'], 104, 64)
    brass = s.track(GM['brass'], 110, 72)
    horn = s.track(GM['horn'], 102, 88)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 3)
        s.chord(trem, b, 3.95, [tri[0] + 12, tri[1] + 12, tri[2] + 12], 82)
        # galloping strings: triplet-feel sixteenths, the wind at her back
        for k in range(16):
            if k % 4 == 3:
                continue
            s.note(sp, b + k * 0.25, 0.2, n(root, 3) + (12 if k % 8 == 4 else 0), 108 if k % 4 == 0 else 80)
    theme = [(0, 1, 'B', 4), (1, 1, 'Gb', 4), (2, 2, 'D', 5), (4, 1, 'Db', 5), (5, 1, 'B', 4), (6, 2, 'Ab', 4),
             (8, 3, 'Gb', 4), (11, 1, 'G', 4), (12, 4, 'Gb', 4),
             (16, 1, 'B', 4), (17, 1, 'Db', 5), (18, 2, 'D', 5), (20, 1, 'E', 5), (21, 1, 'D', 5), (22, 2, 'Db', 5), (24, 8, 'B', 4)]
    for rep in (0, 64):
        for beat, length, name, octv in theme:
            s.note(brass, 32 + rep + beat, length - 0.05, n(name, octv), 112)
            s.note(horn, 32 + rep + beat, length - 0.05, n(name, octv - 1), 98)
    stems['boss_orch'] = render(s, 'vaeltris_orch', 0.65)
    s = Stem(bpm, bars)
    choir = s.track(GM['choir'], 106, 64)
    taiko = s.track(GM['taiko'], 118, 64)
    timp = s.track(GM['timpani'], 110, 58)
    for bar in range(bars):
        root, kind = prog[(bar // 4) % len(prog)]
        b = bar * 4
        tri = triad(root, kind, 4)
        if bar % 2 == 0:
            s.chord(choir, b, 7.9, [tri[0] - 12, tri[0], tri[1], tri[2] + 12], 96 if bar >= 8 else 74)
        for off in (0, 0.5, 1.5, 2, 2.5, 3.5):
            s.note(taiko, b + off, 0.3, n('B', 1), 124 if off in (0, 2) else 92)
        s.note(timp, b, 0.6, n(root, 2), 112)
        s.note(timp, b + 3, 0.3, n(root, 2) + 7, 94)
    stems['boss_choir'] = render(s, 'vaeltris_choir', 0.7)
    return {'stems': stems, 'bpm': bpm, 'bars': bars}


PIECES = {'ashen': ashen, 'ignaroth': ignaroth, 'drowned': drowned, 'thaloryn': thaloryn, 'sky': sky, 'vaeltris': vaeltris}

if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if a in PIECES] or list(PIECES)
    man_path = os.path.join(ROOT, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'sounds': {}, 'music': {}}
    man.setdefault('music', {})
    for nm in names:
        man['music'][nm] = PIECES[nm]()
    json.dump(man, open(man_path, 'w'), indent=1)
