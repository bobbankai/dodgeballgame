// Collect every spoken line in the game (speaker, text, feeling) from the level scripts, so the
// voice recordings can be made for them: `node tools/voices/lines.mjs > lines.json`.
// The key of a line is lineKey(speaker, text), the same function the game uses to find its clip.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lineKey, noteText } from '../../src/audio/lineKey.ts';

const dir = new URL('../../src/levels/', import.meta.url).pathname;
const STR = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
const lit = (s) => new Function(`return ${s}`)();
const out = new Map();
const add = (speaker, text, emotion = null, kind = 'line') => {
  const key = lineKey(speaker, text);
  if (!out.has(key)) out.set(key, { key, speaker, text, emotion, kind });
};

for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  // ['Who', 'text', 'feeling'?] tuples and d.say('Who', 'text') calls
  const tuple = new RegExp(String.raw`\[\s*'(Ada|Pip|Mum|Keeper)',\s*(${STR})(?:,\s*'(\w+)')?\s*\]`, 'g');
  for (const m of src.matchAll(tuple)) add(m[1], lit(m[2]), m[3] ?? null);
  const say = new RegExp(String.raw`\.say\(\s*'(Ada|Pip|Mum|Keeper)',\s*(${STR})(?:,\s*'(\w+)')?\s*\)`, 'g');
  for (const m of src.matchAll(say)) add(m[1], lit(m[2]), m[3] ?? null);
  // the attic's things to look at: Ada's thoughts
  const looks = src.match(/const LOOKS[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (looks) for (const lines of Object.values(lit(looks[1]))) for (const l of lines) add('Ada', l);
  // Mum's notes, read in her voice
  const notes = src.match(/const NOTES[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (notes) for (const n of Object.values(lit(notes[1]))) add('Mum', noteText(n.body), 'tender', 'note');
  for (const m of src.matchAll(new RegExp(String.raw`ui\.note\(\s*(${STR}),\s*(${STR}),\s*''\)`, 'g'))) add('Mum', noteText(lit(m[2])), 'tender', 'note');
}
console.log(JSON.stringify([...out.values()], null, 1));
