"""Records every spoken line in the story scripts with a local neural voice (Kokoro-82M, ONNX).

  /opt/ttsvenv/bin/python eclipse/tools/voices/record.py [--model-dir /opt/eclipse-raw/kokoro] [--redo]

Lines are found by scanning eclipse/src/story/**/*.ts for `say('who', 'text')` calls. Each speaker
has a voice (a blend of Kokoro voice styles), a speed and a treatment applied with ffmpeg:

  kael      bm_george + bm_fable, a little slow and low: a tired knight
  ithra     bf_emma + af_heart: warm, close; a faint shimmer (she speaks from the lantern)
  ignaroth  am_onyx, pitched down ~7 semitones with formants, saturated, in a huge stone hall
  vaeltris  af_sky + bf_isabella, lowered a little, chorused, a long airy echo
  thaloryn  am_onyx + am_michael, pitched down ~6 semitones, a slow flanger (moving water), a drowned hall
  mira      bf_isabella; brannoc bm_lewis (older, slower)

Writes public/assets/audio/voices/<key>.ogg, adds `line:<key>` sounds to the audio manifest and
writes voices/durations.json (seconds) so subtitles track the recordings. The key is the same hash
the game computes (story/Director.ts lineKey). Existing recordings are kept unless --redo.
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'src', 'story')
ROOT = os.path.join(HERE, '..', '..', 'public', 'assets', 'audio')
OUT = os.path.join(ROOT, 'voices')
os.makedirs(OUT, exist_ok=True)
A = sys.argv[1:]
MODEL = A[A.index('--model-dir') + 1] if '--model-dir' in A else '/opt/eclipse-raw/kokoro'
REDO = '--redo' in A

VOICES = {
    'kael': {'blend': [('bm_george', 0.65), ('bm_fable', 0.35)], 'speed': 0.92, 'lang': 'en-gb',
             'fx': 'asetrate=24000*0.96,aresample=24000,atempo=1/0.96,equalizer=f=180:t=q:w=1:g=3,aecho=0.8:0.6:40:0.08'},
    'ithra': {'blend': [('bf_emma', 0.6), ('af_heart', 0.4)], 'speed': 0.9, 'lang': 'en-gb',
              'fx': 'aecho=0.8:0.7:60|113:0.18|0.12,chorus=0.6:0.9:50:0.3:0.25:2,highshelf=f=6000:g=2'},
    'ignaroth': {'blend': [('am_onyx', 0.7), ('bm_george', 0.3)], 'speed': 0.82, 'lang': 'en-gb',
                 'fx': 'asetrate=24000*0.66,aresample=24000,atempo=1/0.66,equalizer=f=90:t=q:w=1:g=6,'
                       'acompressor=threshold=-18dB:ratio=4:attack=5:release=120,'
                       'aecho=0.8:0.85:120|260|430:0.35|0.25|0.18,lowpass=f=6500'},
    # a vast, wet voice from under the water: pitched down, a slow flanger like moving water, a drowned hall
    'thaloryn': {'blend': [('am_onyx', 0.5), ('am_michael', 0.3), ('bm_lewis', 0.2)], 'speed': 0.8, 'lang': 'en-gb',
                 'fx': 'asetrate=24000*0.7,aresample=24000,atempo=1/0.7,equalizer=f=110:t=q:w=1:g=5,'
                       'flanger=delay=3:depth=4:speed=0.25:width=60,'
                       'acompressor=threshold=-18dB:ratio=4:attack=5:release=120,'
                       'aecho=0.8:0.8:90|210|380:0.3|0.22|0.16,lowpass=f=5200'},
    # high, clear and cold, carried on the wind: a little lower, a long airy echo, a faint shimmer
    'vaeltris': {'blend': [('af_sky', 0.5), ('bf_isabella', 0.3), ('af_nicole', 0.2)], 'speed': 0.86, 'lang': 'en-gb',
                 'fx': 'asetrate=24000*0.9,aresample=24000,atempo=1/0.9,equalizer=f=3500:t=q:w=1:g=3,'
                       'chorus=0.6:0.9:40|60:0.25|0.2:0.3|0.25:2|1.5,'
                       'aecho=0.8:0.7:180|410|700:0.3|0.2|0.12,highshelf=f=7000:g=2'},
    'mira': {'blend': [('bf_isabella', 1.0)], 'speed': 1.0, 'lang': 'en-gb', 'fx': 'aecho=0.8:0.5:30:0.05'},
    'brannoc': {'blend': [('bm_lewis', 1.0)], 'speed': 0.86, 'lang': 'en-gb', 'fx': 'aecho=0.8:0.5:30:0.05'},
}

# respellings for words the model reads wrongly
FIX = {'Varn Keld': 'Varn Kelld', 'Ignaroth': 'Igg-na-roth', 'Ithra': 'Ith-ra', 'Aurelion': 'Aw-ree-lee-on', 'Pentarchs': 'Pen-tarks',
       'Thaloryn': 'Tha-lor-in', 'Vaeltris': 'Vale-tris', 'Aethel': 'Eh-thel', 'Sylvaris': 'Sil-var-is', 'Aetheris': 'Ay-thair-is'}


def line_key(who, text):
    """FNV-1a over UTF-16 code units, base 36 (matches Director.ts lineKey)."""
    h = 2166136261
    for ch in text.encode('utf-16-le').decode('utf-16-le'):
        for unit in (ord(ch),) if ord(ch) < 0x10000 else ((0xD800 + ((ord(ch) - 0x10000) >> 10)), (0xDC00 + ((ord(ch) - 0x10000) & 0x3FF))):
            h = ((h ^ unit) * 16777619) & 0xFFFFFFFF
    n = h
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    s = ''
    while True:
        s = digits[n % 36] + s
        n //= 36
        if n == 0:
            break
    return f'{who}_{s}'


def find_lines():
    # say('who', 'text'), bark('who', 'text') and ['who', 'text'] tuples (bark lists)
    pats = [re.compile(r"""(?:say|bark)\(\s*'(\w+)'\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2""", re.S),
            re.compile(r"""\[\s*'(\w+)'\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2\s*\]""", re.S)]
    lines = []
    seen = set()
    for f in sorted(glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True)):
        src = open(f, encoding='utf-8').read()
        for pat in pats:
            for m in pat.finditer(src):
                who, text = m.group(1), m.group(3).replace("\\'", "'").replace('\\"', '"')
                if who in VOICES and (who, text) not in seen:
                    seen.add((who, text))
                    lines.append((who, text))
    return lines


def main():
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(MODEL, 'kokoro-v1.0.onnx'), os.path.join(MODEL, 'voices-v1.0.bin'))
    man_path = os.path.join(ROOT, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'sounds': {}, 'music': {}}
    dur_path = os.path.join(OUT, 'durations.json')
    durations = json.load(open(dur_path)) if os.path.exists(dur_path) else {}
    lines = find_lines()
    print(len(lines), 'lines')
    for who, text in lines:
        key = line_key(who, text)
        out = os.path.join(OUT, f'{key}.ogg')
        if os.path.exists(out) and not REDO and key in durations:
            man['sounds'][f'line:{key}'] = {'files': [f'voices/{key}.ogg'], 'volume': 1.0, 'pitch': 0, 'bus': 'voice'}
            continue
        v = VOICES.get(who, VOICES['kael'])
        style = sum(k.get_voice_style(name) * w for name, w in v['blend'])
        spoken = text
        for a, b in FIX.items():
            spoken = spoken.replace(a, b)
        samples, sr = k.create(spoken, voice=style, speed=v['speed'], lang=v['lang'])
        # trim, pad a breath either side
        samples = np.concatenate([np.zeros(int(0.05 * sr)), samples, np.zeros(int(0.35 * sr))])
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
            sf.write(tf.name, samples, sr)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tf.name, '-af', v['fx'] + ',loudnorm=I=-18:TP=-2',
                            '-ar', '48000', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '5', out], check=True)
            os.unlink(tf.name)
        info = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], capture_output=True, text=True)
        durations[key] = round(float(info.stdout.strip()) - 0.3, 2)
        man['sounds'][f'line:{key}'] = {'files': [f'voices/{key}.ogg'], 'volume': 1.0, 'pitch': 0, 'bus': 'voice'}
        print('recorded', key, durations[key], 's:', text[:60])
    json.dump(durations, open(dur_path, 'w'), indent=1)
    json.dump(man, open(man_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
