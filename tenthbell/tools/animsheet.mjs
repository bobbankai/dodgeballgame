// node tenthbell/tools/animsheet.mjs <char> <out.png> "clip@t clip@t ..." [yawDeg=-90] [cols=6]
// Renders frozen poses of a fighter in the look-dev viewer (headless WebGPU) and tiles them into one sheet.
import { execFileSync } from 'child_process';
import fs from 'fs';
const [char, out, list, yaw = '-90', cols = '6'] = process.argv.slice(2);
const dir = out.replace(/\.png$/, '_frames');
const poses = list.split(/\s+/).filter(Boolean).map((p) => p.split('@'));
const steps = [{ eval: `__cam(${yaw},4,4.6,0.95,0.5)` }];
poses.forEach(([clip, t], i) => steps.push({ eval: `__pose('${clip}', ${t})`, t: 0.02, shot: String(i).padStart(3, '0') }));
console.log(execFileSync('node', [new URL('./play.mjs', import.meta.url).pathname, `http://localhost:5175/?test&quality=medium&view=chars/${char}`, dir, JSON.stringify(steps), '520', '440'], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n').filter((l) => !/BJS -|\[eval\] (22|null|undefined|\d)/.test(l)).slice(0, 12).join('\n'));
const py = `
from PIL import Image, ImageDraw
import sys, glob
fs = sorted(glob.glob('${dir}/*.png')); names = ${JSON.stringify(poses.map((p) => p.join(' ')))}; cols = ${cols}
ims = [Image.open(f).crop((120, 30, 400, 430)) for f in fs]
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * 280, rows * 400))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * 280, (i // cols) * 400)); d.text(((i % cols) * 280 + 6, (i // cols) * 400 + 4), names[i], fill=(255, 255, 0))
sheet.save('${out}')
`;
execFileSync('python3', ['-c', py]);
