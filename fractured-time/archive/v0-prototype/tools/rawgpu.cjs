const { chromium } = require('playwright');
(async () => {
  const base = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist'];
  const variants = { base, 'no-watchdog': [...base, '--disable-gpu-watchdog'], 'in-process': [...base, '--in-process-gpu'], 'single': [...base, '--disable-gpu-watchdog', '--disable-features=DawnSignalFd'], headful: null };
  for (const [name, args] of Object.entries(variants)) {
    if (!args) continue;
    const b = await chromium.launch({ args });
    const p = await b.newPage();
    await p.goto('http://localhost:5180/blank.html');
    const r = await p.evaluate(async () => {
      const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice(); let lost = null;
      d.lost.then((i) => { lost = i.reason + ':' + i.message + '@' + Math.round(performance.now()); });
      await new Promise((r) => setTimeout(r, 1500));
      return { lost };
    });
    console.log(name.padEnd(12), JSON.stringify(r));
    await b.close();
  }
})();
