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

function where(map, l) {
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
const jobs = process.argv.slice(2).length ? process.argv.slice(2).map((f) => build(path.resolve(f))) : [build(null)];
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
