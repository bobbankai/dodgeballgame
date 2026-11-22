// node vowbreaker/tools/wgsl_check.mjs [extra.wgsl ...]
// Compiles the WGSL include library (src/shaders/lib, in the order of lib/order.txt) with the real
// WebGPU stack (headless Chromium, SwiftShader adapter) and prints every error with its file and line.
// Extra files are appended after the library (each checked on its own), for pure-WGSL compute shaders.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import http from 'http';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const libDir = path.join(root, 'src/shaders/lib');
const order = fs.readFileSync(path.join(libDir, 'order.txt'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('//'));

// Babylon's WGSL preprocessor splits on ';' while reading struct bodies: a semicolon inside a
// comment in a struct breaks the shader at runtime even though the WGSL itself is valid.
for (const f of fs.readdirSync(libDir).filter((n) => n.endsWith('.wgsl'))) {
  const src = fs.readFileSync(path.join(libDir, f), 'utf8');
  for (const m of src.matchAll(/struct\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    if (m[2].includes(';')) console.log(`lib/${f}: struct ${m[1]} has a ';' in its body (breaks Babylon's preprocessor)`);
  }
}

function build(extra) {
  let code = '';
  const map = []; // [startLine, file]
  let line = 1;
  const add = (file, src) => {
    map.push([line, file]);
    code += src + '\n';
    line += src.split('\n').length;
  };
  for (const f of order) add('lib/' + f + '.wgsl', fs.readFileSync(path.join(libDir, f + '.wgsl'), 'utf8'));
  if (extra) add(extra, fs.readFileSync(extra, 'utf8').replace(/^#include<.*>$/gm, '// (include inlined above)'));
  else add('<stub>', '@fragment fn stubEntry() -> @location(0) vec4f { return vec4f(0.0); }');
  return { code, map };
}

// Babylon-style material / post shaders (*.fragment.wgsl, *.vertex.wgsl): run the parts of
// Babylon's WGSL preprocessor these files use (defines, #ifdef, the listed #include<vb_*> in
// order, attribute / varying / uniform declarations, texture bindings, the entry point's in/out
// structs) so a whole shader can be compiled without booting the game.
const DEFAULT_DEFINES = ['VERTEXCOLOR', 'UV1', 'UV2'];
function buildBabylon(file) {
  const src = fs.readFileSync(file, 'utf8');
  const vertex = file.endsWith('.vertex.wgsl');
  const defines = new Set(DEFAULT_DEFINES);
  const lines = src.split('\n');
  const out = [];       // [text, file, line]
  const stack = [];     // conditional state: true = emitting
  const emitting = () => stack.every((x) => x);
  const attrs = [], varyings = [], uniforms = [];
  const extraLib = new Set();
  lines.forEach((raw, i) => {
    const t = raw.trim();
    let m;
    if ((m = t.match(/^#ifdef\s+(\w+)/))) { stack.push(defines.has(m[1])); return; }
    if ((m = t.match(/^#ifndef\s+(\w+)/))) { stack.push(!defines.has(m[1])); return; }
    if ((m = t.match(/^#if\s+defined\((\w+)\)/))) { stack.push(defines.has(m[1])); return; }
    if (t.startsWith('#if')) { stack.push(true); return; }
    if (t.startsWith('#else')) { stack[stack.length - 1] = !stack[stack.length - 1]; return; }
    if (t.startsWith('#endif')) { stack.pop(); return; }
    if (!emitting()) return;
    if ((m = t.match(/^#define\s+(\w+)/))) { defines.add(m[1]); return; }
    if ((m = t.match(/^#include<(\w+)>/))) {
      const name = m[1];
      if (name.startsWith('vb_')) {
        const f = name.slice(3);
        const text = fs.readFileSync(path.join(libDir, f + '.wgsl'), 'utf8');
        text.split('\n').forEach((l, j) => out.push([l, 'lib/' + f + '.wgsl', j + 1]));
      } else if (name === 'instancesVertex') {
        out.push(['var finalWorld = mat4x4f(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);', file, i + 1]);
      } else {
        out.push(['// (babylon include ' + name + ')', file, i + 1]);
      }
      return;
    }
    if ((m = t.match(/^attribute\s+(\w+)\s*:\s*([^;]+);/))) { attrs.push([m[1], m[2].trim()]); out.push(['', file, i + 1]); return; }
    if ((m = t.match(/^varying\s+(\w+)\s*:\s*([^;]+);/))) { varyings.push([m[1], m[2].trim()]); out.push(['', file, i + 1]); return; }
    if ((m = t.match(/^uniform\s+(\w+)\s*:\s*([^;]+);/))) { uniforms.push([m[1], m[2].trim()]); out.push(['', file, i + 1]); return; }
    out.push([raw, file, i + 1]);
  });
  // module-scope textures / samplers get bindings
  let binding = 0;
  for (const o of out) {
    if (o[1] !== file) continue;
    if (/^var\s+\w+\s*:\s*(texture_|sampler)/.test(o[0])) o[0] = `@group(1) @binding(${binding++}) ` + o[0];
  }
  // the entry point: copy the inputs in, return the outputs at the end
  const fileText = out.filter((o) => o[1] === file).map((o) => o[0]).join('\n');
  const usesFront = /fragmentInputs\.frontFacing/.test(fileText);
  const usesDepth = /fragmentOutputs\.fragDepth/.test(fileText);
  const entry = out.findIndex((o) => o[1] === file && /^\s*fn\s+main\s*\(/.test(o[0]));
  if (entry >= 0) {
    for (let k = entry - 1; k >= 0 && k > entry - 3; k--) if (/^\s*@(fragment|vertex)\s*$/.test(out[k][0])) out[k][0] = '';
    out[entry][0] = (vertex ? '@vertex ' : '@fragment ') + out[entry][0].replace(/\{\s*$/, '{ ' + (vertex ? 'vertexInputs = input;' : 'fragmentInputs = input;'));
    // find the brace that closes main
    let depth = 0, started = false;
    for (let k = entry; k < out.length; k++) {
      for (const ch of out[k][0].replace(/\/\/.*$/, '')) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') depth--;
      }
      if (started && depth === 0) {
        const idx = out[k][0].lastIndexOf('}');
        out[k][0] = out[k][0].slice(0, idx) + (vertex ? 'return vertexOutputs; }' : 'return fragmentOutputs; }') + out[k][0].slice(idx + 1);
        break;
      }
    }
  }
  const flatT = (ty) => /^(i32|u32|vec\du|vec\di)/.test(ty) ? '@interpolate(flat) ' : '';
  const gen = [];
  gen.push('struct FragmentInputs {', '  @builtin(position) position: vec4f,');
  if (usesFront && !vertex) gen.push('  @builtin(front_facing) frontFacing: bool,');
  varyings.forEach(([n, ty], k) => gen.push(`  @location(${k}) ${flatT(ty)}${n}: ${ty},`));
  gen.push('}');
  if (vertex) {
    gen.push('struct VertexInputs {');
    attrs.forEach(([n, ty], k) => gen.push(`  @location(${k}) ${n}: ${ty},`));
    if (!attrs.length) gen.push('  @builtin(vertex_index) vertexIndex: u32,');
    gen.push('}', 'var<private> vertexInputs: VertexInputs;', 'var<private> vertexOutputs: FragmentInputs;');
  } else {
    gen.push('struct FragmentOutputs {', '  @location(0) color: vec4f,');
    if (usesDepth) gen.push('  @builtin(frag_depth) fragDepth: f32,');
    gen.push('}', 'var<private> fragmentInputs: FragmentInputs;', 'var<private> fragmentOutputs: FragmentOutputs;');
  }
  if (uniforms.length) {
    gen.push('struct Uniforms {');
    for (const [n, ty] of uniforms) gen.push(`  ${n}: ${ty},`);
    gen.push('}', '@group(0) @binding(0) var<uniform> uniforms: Uniforms;');
  }
  let code = '';
  const map = [];
  let line = 1;
  let last = null;
  // Babylon turns this define into a diagnostic directive at the top of the module
  if (defines.has('DISABLE_UNIFORMITY_ANALYSIS')) out.unshift(['diagnostic(off, derivative_uniformity);', '<generated>', 0]);
  for (const [text, f, l] of [...out, ...gen.map((g, k) => [g, '<generated>', k + 1])]) {
    const key = f + ':' + (l - line);
    if (key !== last) { map.push([line, f, l]); last = key; }
    code += text + '\n';
    line++;
  }
  map.push([line, file, 0]);
  return { code, map, babylon: true };
}

function where(map, l) {
  if (map[0].length === 3) {
    let f = map[0];
    for (const m of map) if (m[0] <= l) f = m;
    return `${f[1]}:${l - f[0] + f[2]}`;
  }
  let f = map[0];
  for (const m of map) if (m[0] <= l) f = m;
  return `${f[1]}:${l - f[0] + 1}`;
}

const server = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/`);
const pick = (f) => (/\.(fragment|vertex)\.wgsl$/.test(f) ? buildBabylon(f) : build(f));
const jobs = process.argv.slice(2).length ? process.argv.slice(2).map((f) => pick(path.resolve(f))) : [build(null)];
let failed = 0;
for (const job of jobs) {
  const msgs = await page.evaluate(async (code) => {
    const a = await navigator.gpu.requestAdapter();
    const d = await a.requestDevice();
    const m = d.createShaderModule({ code });
    const info = await m.getCompilationInfo();
    return info.messages.map((x) => ({ type: x.type, line: x.lineNum, col: x.linePos, msg: x.message }));
  }, job.code);
  const errs = msgs.filter((m) => m.type === 'error');
  for (const m of msgs.slice(0, 40)) console.log(`${m.type} ${where(job.map, m.line)}:${m.col} ${m.msg.split('\n')[0]}`);
  failed += errs.length;
  console.log(`${job.map[job.map.length - 1][1]}: ${job.code.split('\n').length} lines, ${errs.length} errors`);
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
