// GPU frame timing with EXT_disjoint_timer_query_webgl2 (where the browser exposes it).
import type * as THREE from 'three';

export class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** smoothed GPU milliseconds per frame (0 when unsupported) */
  ms = 0;
  readonly supported: boolean;

  constructor(r: THREE.WebGLRenderer) {
    this.gl = r.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = !!this.ext;
  }

  begin(): void {
    if (!this.ext || this.active) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    const gl = this.gl;
    if (!this.ext || !this.active) return;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.active);
    this.active = null;
    // poll finished queries
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        this.ms += (ns / 1e6 - this.ms) * 0.1;
      }
      gl.deleteQuery(q);
      this.queries.shift();
    }
    if (this.queries.length > 8) {
      for (const q of this.queries) gl.deleteQuery(q);
      this.queries.length = 0;
    }
  }
}
