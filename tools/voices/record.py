"""Record every line of dialogue with a neural voice (Kokoro-82M, run locally with kokoro-onnx).

    node tools/voices/lines.mjs > lines.json
    python tools/voices/record.py lines.json <kokoro dir> [--only KEY,KEY] [--force]

<kokoro dir> holds model/model.onnx and voices.npz, made from the Hugging Face repo
onnx-community/Kokoro-82M-v1.0-ONNX (onnx/model.onnx; voices/*.bin, each reshaped to (-1, 1, 256)
and saved together with numpy.savez). Writes src/assets/voices/<key>.mp3 and manifest.json: per
line its duration and a loudness envelope (40 per second, one base-36 digit each) which the game
uses to move the mouth and pace the text.

Each character is a voice of their own: a blend of Kokoro speakers, a speaking rate, and a shift
that moves pitch and formants together (a smaller or larger voice) by playing the recording at a
different rate. The model is asked to speak slower or faster by the same factor beforehand, so the
shift costs no time-stretching artefacts.
"""
import json, os, re, subprocess, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'voices')
SR = 24000
FPS = 40

# who: (style blend, lang, rate, shift)
#   Ada, twelve: Bella with a little of her mother's voice in it, a size smaller.
#   Pip, a paper fox made of a bit of Mum: Puck and Heart blended, small and quick.
#   Mum: Heart, unhurried.
#   The Keeper, an old crane of a lighthouse keeper: George, slower and a size larger.
VOICES = {
    'Ada': ({'af_bella': 0.8, 'af_heart': 0.2}, 'en-us', 1.0, 1.22),
    'Pip': ({'af_heart': 0.6, 'am_puck': 0.4}, 'en-us', 1.06, 1.36),
    'Mum': ({'af_heart': 1.0}, 'en-us', 0.93, 1.0),
    'Keeper': ({'bm_george': 1.0}, 'en-gb', 0.86, 0.88),
}
# how a feeling changes the delivery: rate and a small pitch lift
FEEL = {
    'neutral': (1.0, 1.0), 'happy': (1.04, 1.02), 'joy': (1.1, 1.04), 'sad': (0.88, 0.97),
    'tender': (0.92, 0.99), 'scared': (1.12, 1.04), 'worried': (1.0, 1.01), 'surprised': (1.06, 1.04),
    'wonder': (0.92, 1.01), 'angry': (1.06, 0.99), 'curious': (1.02, 1.02), 'determined': (1.0, 0.99),
}


# lines the model gets wrong as written: what it reads instead, or (with ph:) the phonemes
FIX = {
    'Ow.': 'ph:ˈaʊ!',
    'The best bit, she would say.': 'The best bit... she would say.',
    'I know, love. I know.': 'I know... love. I know.',
    'Pip. Folded from the corner of page forty-one. I have been waiting for you, Ada.':
        'Pip! Folded from the corner of page forty-one. I have been waiting for you, Ada.',
}


def tts_text(t: str) -> str:
    """What the model reads: shouted words in lower case (else they are spelled out), dashes as
    pauses, no leading ellipsis."""
    t = re.sub(r"\b([A-Z]{2,}(?:'[A-Z]+)?)\b", lambda m: m.group(1).lower() if m.group(1) not in ('OK',) else m.group(1), t)
    t = t.replace('—', ', ').replace('–', ', ')
    t = re.sub(r'^\s*\.\.\.\s*', '', t)
    t = re.sub(r'\s+,', ',', t)
    return t.strip()


def trim(s: np.ndarray, pad=0.06) -> np.ndarray:
    a = np.abs(s)
    on = np.where(a > 0.01 * a.max())[0]
    if not len(on):
        return s
    i0 = max(0, on[0] - int(pad * SR))
    i1 = min(len(s), on[-1] + int(pad * 2 * SR))
    return s[i0:i1]


def level(s: np.ndarray, target_db=-19.0) -> np.ndarray:
    """Even loudness across lines: scale the voiced frames' RMS to a target, keep peaks under -1 dB."""
    hop = SR // 50
    fr = s[: len(s) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((fr ** 2).mean(1) + 1e-12)
    act = rms[rms > 0.1 * rms.max()]
    g = 10 ** (target_db / 20) / max(np.sqrt((act ** 2).mean()), 1e-6)
    s = s * g
    pk = np.abs(s).max()
    if pk > 0.89:
        s = np.tanh(s / pk * 1.4) / np.tanh(1.4) * 0.89
    return s


def envelope(s: np.ndarray) -> str:
    hop = SR // FPS
    n = int(np.ceil(len(s) / hop))
    pad = np.zeros(n * hop, np.float32)
    pad[: len(s)] = s
    rms = np.sqrt((pad.reshape(n, hop) ** 2).mean(1))
    ref = np.percentile(rms, 95) + 1e-6
    v = np.clip(rms / ref, 0, 1) ** 0.7
    return ''.join(np.base_repr(int(round(x * 35)), 36).lower() for x in v)


def main():
    args = sys.argv[1:]
    lines = json.load(open(args[0]))
    kdir = args[1]
    only = None
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
    force = '--force' in args
    from kokoro_onnx import Kokoro

    k = Kokoro(os.path.join(kdir, 'model', 'model.onnx'), os.path.join(kdir, 'voices.npz'))
    styles = {w: sum(a * k.get_voice_style(v) for v, a in blend.items()) for w, (blend, *_r) in VOICES.items()}
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    keep = {l['key'] for l in lines}
    for key in list(manifest):
        if key not in keep:
            del manifest[key]
            if os.path.exists(os.path.join(OUT, key + '.mp3')):
                os.remove(os.path.join(OUT, key + '.mp3'))
    for i, l in enumerate(lines):
        key, who = l['key'], l['speaker']
        if only and key not in only:
            continue
        mp3 = os.path.join(OUT, key + '.mp3')
        if not force and key in manifest and os.path.exists(mp3):
            continue
        if not re.search(r'[A-Za-z]', l['text']):
            continue  # a silence ('...'): nothing to say
        _blend, lang, rate, shift = VOICES[who]
        feel = l.get('emotion') or 'neutral'
        frate, flift = FEEL.get(feel, (1.0, 1.0))
        shift *= flift
        note = l.get('kind') == 'note'
        # ask for speech `shift` times slower, then play it `shift` times faster: higher and smaller
        say = FIX.get(l['text'], tts_text(l['text']))
        ph = say.startswith('ph:')
        s, sr = k.create(say[3:] if ph else say, is_phonemes=ph, voice=styles[who], speed=rate * frate / shift, lang=lang,
                         sentence_pause=0.5 if note else 0.3, clause_pause=0.14 if note else 0.1)
        assert sr == SR
        s = trim(s.astype(np.float32))
        raw = s.tobytes()
        wav = subprocess.run(
            ['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(round(SR * shift)), '-ac', '1', '-i', '-',
             '-af', 'aresample=24000:resampler=soxr,highpass=f=70', '-f', 'f32le', '-ar', str(SR), '-'],
            input=raw, capture_output=True, check=True).stdout
        s = level(np.frombuffer(wav, np.float32).copy())
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
             '-c:a', 'libmp3lame', '-b:a', '56k', mp3],
            input=s.astype(np.float32).tobytes(), check=True)
        manifest[key] = {'d': round(len(s) / SR, 3), 'e': envelope(s)}
        print(f'{i + 1}/{len(lines)} {who:6s} {len(s) / SR:5.2f}s  {l["text"][:70]}', flush=True)
        if i % 10 == 0:
            json.dump(manifest, open(mpath, 'w'), separators=(',', ':'), sort_keys=True)
    json.dump(manifest, open(mpath, 'w'), separators=(',', ':'), sort_keys=True)


if __name__ == '__main__':
    main()
