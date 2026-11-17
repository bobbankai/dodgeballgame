import type { GraphicsSystem } from '../core/GraphicsSystem';
import { DEBUG_VIEWS } from '../postprocessing/FrameGraph';

/**
 * Performance overlay (F3, or `?perf`): backend, preset, render size and dynamic scale, frame time (mean, 99th percentile),
 * GPU time where timestamps exist, draw calls, triangles, live GPU objects, texture memory, exposure, live stages and any
 * stage that failed to build. F4 / Shift+F4 step through the debug views.
 */
export class PerfOverlay {
  private el: HTMLDivElement | null = null;
  private nextAt = 0;

  constructor(private gfx: GraphicsSystem) {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(location.search).has('perf')) this.toggle();
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.toggle(); }
      if (e.code === 'F4') {
        e.preventDefault();
        const i = DEBUG_VIEWS.indexOf(this.gfx.debugView);
        const n = DEBUG_VIEWS.length;
        this.gfx.setDebugView(DEBUG_VIEWS[(i + (e.shiftKey ? n - 1 : 1)) % n]);
      }
    });
  }

  toggle(): void {
    if (this.el) { this.el.remove(); this.el = null; return; }
    const el = document.createElement('div');
    el.className = 'gfx-perf';
    Object.assign(el.style, {
      position: 'fixed', left: '8px', top: '8px', zIndex: '50', pointerEvents: 'none', whiteSpace: 'pre',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#d8e6ef', background: 'rgba(6,10,14,0.72)',
      padding: '8px 10px', borderRadius: '4px', border: '1px solid rgba(120,170,200,0.25)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    this.el = el;
  }

  update(): void {
    if (!this.el) return;
    const now = performance.now();
    if (now < this.nextAt) return;
    this.nextAt = now + 250;
    const g = this.gfx;
    const r = g.renderer;
    const info = r.info as any;
    const w = Math.round(r.domElement.width), h = Math.round(r.domElement.height);
    const t = g.timing;
    const mem = g.resources.memory();
    const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
    const lines = [
      `${g.caps.backend.toUpperCase()}  ${g.settings.preset}  ${w}x${h}  scale ${g.resolution.dynamic.toFixed(2)}`,
      `frame ${t.frameMs.toFixed(1)} ms (${t.fps.toFixed(0)} fps)  p99 ${t.p99Ms.toFixed(1)} ms` + (t.gpuMs !== null ? `  gpu ${t.gpuMs.toFixed(1)} ms` : '  gpu n/a'),
      `draws ${info.render?.drawCalls ?? '?'}  tris ${((info.render?.triangles ?? 0) / 1000).toFixed(0)}k  geo ${info.memory?.geometries ?? '?'}  tex ${info.memory?.textures ?? '?'}  files ${mb(mem.textures)}`,
      `exposure ${g.exposure.current.toFixed(2)}${g.exposure.gpu ? `  meter ${g.exposure.measured.toFixed(4)}` : '  (cpu)'}  view ${g.debugView}`,
      `live: ${g.graph.features.join(', ')}`,
    ];
    if (g.graph.failures.length) lines.push(`FAILED: ${g.graph.failures.map((f) => `${f.stage} (${f.error.slice(0, 60)})`).join('; ')}`);
    this.el.textContent = lines.join('\n');
  }
}
