const { chromium } = require('playwright');
(async () => {
  const W = ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist'];
  const variants = {
    'A vulkan+angle-swift': [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'],
    'B no-angle-flag':      [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'],
    'C angle=vulkan':       [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=vulkan', '--use-vulkan=swiftshader'],
    'D gl-swift+disable-gpu-compositing': [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--disable-gpu-compositing'],
    'E in-process-gpu':     [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--in-process-gpu'],
    'F use-gl=angle,swiftshader-webgl': [...W, '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-gl=angle', '--use-angle=swiftshader-webgl'],
  };
  for (const [name, args] of Object.entries(variants).slice(0, 2)) {
    const b = await chromium.launch({ args, channel: process.env.CH || undefined, headless: !process.env.HEADFUL }); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
    await p.goto('http://localhost:5180/blank.html');
    const r = await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'; document.body.appendChild(c);
      const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice(); let lost = null;
      d.lost.then((i) => { lost = i.reason + '@' + Math.round(performance.now()); });
      const ctx = c.getContext('webgpu'); ctx.configure({ device: d, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
      for (let i = 0; i < 20; i++) {
        const enc = d.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: i / 20, g: 0.4, b: 0.6, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.end(); d.queue.submit([enc.finish()]);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => setTimeout(r, 800));
      return { lost };
    }).catch((e) => ({ err: String(e).slice(0, 120) }));
    console.log(name.padEnd(36), JSON.stringify(r));
    await b.close();
  }
})();
