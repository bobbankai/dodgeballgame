// Test-mode only. Headless Chromium's software WebGPU adapter (SwiftShader) destroys the device as soon
// as a canvas swap-chain texture is requested, while offscreen rendering works. So under ?test the
// canvas's 'webgpu' context is replaced by a stand-in whose "current texture" is an ordinary GPU texture;
// present() reads that texture back and paints it into a 2D canvas laid over the game, which is what
// screenshots capture. The real game never loads this.

interface FakeContext {
  canvas: HTMLCanvasElement;
  configure(cfg: GPUCanvasConfiguration): void;
  unconfigure(): void;
  getCurrentTexture(): GPUTexture;
  getConfiguration(): GPUCanvasConfiguration | null;
}

let device: GPUDevice | null = null;
let format: GPUTextureFormat = 'rgba8unorm';
let tex: GPUTexture | null = null;
let fakeCanvas: HTMLCanvasElement | null = null;
let overlay: HTMLCanvasElement | null = null;

export function installHeadlessShim(): void {
  const orig = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, kind: string, opts?: unknown) {
    if (kind !== 'webgpu') return orig.call(this, kind as any, opts as any);
    fakeCanvas = this;
    let config: GPUCanvasConfiguration | null = null;
    const ctx: FakeContext = {
      canvas: this,
      configure(cfg) {
        config = cfg;
        device = cfg.device;
        format = cfg.format;
        tex?.destroy();
        tex = null;
      },
      unconfigure() { config = null; },
      getConfiguration() { return config; },
      getCurrentTexture() {
        const w = Math.max(1, this.canvas.width), h = Math.max(1, this.canvas.height);
        if (!tex || tex.width !== w || tex.height !== h) {
          tex?.destroy();
          tex = device!.createTexture({
            size: [w, h],
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
          });
        }
        return tex;
      },
    };
    return ctx;
  };
}

/** Copies the last rendered frame into the visible 2D overlay canvas. */
export async function presentHeadless(): Promise<void> {
  if (!device || !tex || !fakeCanvas) return;
  const w = tex.width, h = tex.height;
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const img = new ImageData(w, h);
  const bgra = format.startsWith('bgra');
  for (let y = 0; y < h; y++) {
    const ro = y * bpr, wo = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = ro + x * 4, o = wo + x * 4;
      img.data[o] = src[i + (bgra ? 2 : 0)];
      img.data[o + 1] = src[i + 1];
      img.data[o + 2] = src[i + (bgra ? 0 : 2)];
      img.data[o + 3] = 255;
    }
  }
  buf.unmap();
  buf.destroy();
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
    document.body.appendChild(overlay);
  }
  overlay.width = w;
  overlay.height = h;
  overlay.getContext('2d')!.putImageData(img, 0, 0);
}
