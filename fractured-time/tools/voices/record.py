"""Record every line of FRACTURED TIME dialogue with a neural voice (Kokoro-82M via kokoro-onnx, run locally, Apache-2.0).

    python3 tools/voices/record.py [--only WHO] [--force]

Lines are collected from the chapter scripts (src/chapters/*.ts): every ['WHO', 'text', seconds?] tuple. Each is written to
public/assets/voices/<key>.mp3 with public/assets/voices/manifest.json: {key: {who, text, dur}}; the key is a hash of who + text, so an
edited line is re-recorded and an unchanged one is skipped. The game plays a line when its key is in the manifest (ChapterRuntime.say),
times the subtitle to it and puts the voice through its speaker's treatment (radio, PA, the Echo's doubling: src/audio/voice.ts).

Each character is a blend of Kokoro speakers, a rate and a pitch/size shift (the take is rendered faster or slower and played back at
the other rate, so pitch and formants move together without time-stretch artefacts).
"""
import hashlib
import json
import os
import re
import subprocess
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'voices')
KDIR = os.path.join(ROOT, 'vendor', 'kokoro')
SR = 24000

# who: (speaker blend, lang, rate, shift)  shift < 1: a larger, deeper voice
VOICES = {
    'ETHAN': ({'am_onyx': 0.55, 'am_michael': 0.45}, 'en-us', 0.95, 0.96),
    'THE ECHO': ({'am_onyx': 0.55, 'am_michael': 0.45}, 'en-us', 0.9, 0.93),
    'HELIX SYSTEM': ({'bf_emma': 0.7, 'af_nicole': 0.3}, 'en-gb', 0.98, 1.0),
    'COMMANDER NYX': ({'bf_isabella': 0.6, 'af_kore': 0.4}, 'en-gb', 1.03, 0.95),
    'DIRECTOR VOSS': ({'bm_george': 0.7, 'bm_lewis': 0.3}, 'en-gb', 0.9, 0.93),
    'HELIX TROOPER': ({'am_eric': 0.7, 'am_adam': 0.3}, 'en-us', 1.1, 0.97),
    'DR. IMANI REYES': ({'af_sarah': 0.6, 'af_nova': 0.4}, 'en-us', 1.0, 1.0),
    'IMANI': ({'af_sarah': 0.6, 'af_nova': 0.4}, 'en-us', 1.0, 1.0),
}
# respellings for words the model misreads
FIX = {'A-07': 'A zero seven', 'HELIX': 'Helix', 'C-1': 'C one', 'B-2': 'B two'}


def key(who: str, text: str) -> str:
    return hashlib.sha1(f'{who}|{text}'.encode()).hexdigest()[:12]


def collect():
    lines = {}
    rx = re.compile(r"\[\s*'([A-Z .]+)'\s*,\s*'((?:[^'\\]|\\.)*)'")
    for f in sorted(os.listdir(os.path.join(ROOT, 'src', 'chapters'))):
        if f.endswith('.ts'):
            for who, text in rx.findall(open(os.path.join(ROOT, 'src', 'chapters', f)).read()):
                text = text.replace("\\'", "'")
                if who in VOICES:
                    lines[key(who, text)] = (who, text)
    return lines


def tts_text(t: str) -> str:
    for a, b in FIX.items():
        t = t.replace(a, b)
    t = re.sub(r'^\s*\.\.\.\s*', '', t)
    return t


def trim(s, pad=0.05):
    a = np.abs(s)
    idx = np.where(a > 0.01 * a.max())[0]
    if not len(idx):
        return s
    p = int(pad * SR)
    return s[max(0, idx[0] - p): idx[-1] + p]


def level(s, target_db=-18.0):
    rms = np.sqrt(np.mean(s ** 2)) + 1e-9
    g = 10 ** (target_db / 20) / rms
    out = s * g
    peak = np.abs(out).max()
    return out / peak * 0.95 if peak > 0.95 else out


def main():
    from kokoro_onnx import Kokoro
    argv = sys.argv[1:]
    only = argv[argv.index('--only') + 1] if '--only' in argv else None
    force = '--force' in argv
    os.makedirs(OUT, exist_ok=True)
    man_p = os.path.join(OUT, 'manifest.json')
    man = json.load(open(man_p)) if os.path.exists(man_p) else {}
    k = Kokoro(os.path.join(KDIR, 'kokoro-v1.0.onnx'), os.path.join(KDIR, 'voices-v1.0.bin'))
    styles = {}
    for who, (blend, *_r) in VOICES.items():
        styles[who] = sum(k.get_voice_style(v) * w for v, w in blend.items())
    lines = collect()
    for kk, (who, text) in lines.items():
        if only and who != only:
            continue
        path = os.path.join(OUT, f'{kk}.mp3')
        if not force and kk in man and os.path.exists(path):
            continue
        _blend, lang, rate, shift = VOICES[who]
        s, sr = k.create(tts_text(text), voice=styles[who], speed=rate / shift, lang=lang)
        s = level(trim(np.asarray(s, dtype=np.float32)))
        # play the take back at `shift` (pitch and formants move together): resample by 1/shift
        n = int(len(s) / shift)
        s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s).astype(np.float32)
        raw = path.replace('.mp3', '.f32')
        s.tofile(raw)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', raw, '-b:a', '96k', path], check=True)
        os.remove(raw)
        man[kk] = {'who': who, 'text': text, 'dur': round(len(s) / sr, 3)}
        print(f'{who:16s} {len(s) / sr:5.2f}s  {text}')
    for kk in [x for x in man if x not in lines]:
        man.pop(kk)
    json.dump(man, open(man_p, 'w'), indent=1)
    print('lines', len(man))


if __name__ == '__main__':
    main()
