import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Shadows of moving things (characters, enemies, doors, debris) cast onto the baked world.
 *
 * The world's own shadows are in its lightmaps (infinitely cached, path traced); what the bake cannot know is everything that
 * moves. Those objects go on a caster layer and are drawn, depth only, into one orthographic shadow map fitted round the
 * player each frame, from the direction the light around them actually comes from (the dominant direction of the baked SH
 * probe there, kept at least 35 degrees above the horizon: interiors are lit from their ceilings).
 *
 * Baked surfaces read the map with contact-hardening soft shadows (PCSS: a blocker search sets the penumbra, wide for a
 * body far above the floor and sharp where a foot meets it; Poisson taps rotated per pixel and resolved by TAA). Only the
 * light that came from that direction is taken away (`strength`, from how directional the probe is): in a room lit from
 * everywhere a character leaves a soft dimming, under a single lamp a real shadow.
 */
const T = TSL as any;
const { Fn, uniform, texture, vec2, vec3, vec4, float, positionWorld, normalWorldGeometry, If, max, min, mix, smoothstep, abs, sin, cos,
  interleavedGradientNoise, screenCoordinate, select } = T;

export const CASTER_LAYER = 5;

// 12-tap Poisson disc (unit radius)
const POISSON: [number, number][] = [
  [-0.326, -0.406], [-0.840, -0.074], [-0.696, 0.457], [-0.203, 0.621], [0.962, -0.195], [0.473, -0.480],
  [0.519, 0.767], [0.185, -0.893], [0.507, 0.064], [0.896, 0.412], [-0.322, -0.933], [-0.792, -0.598],
];

export class DynamicShadows {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  readonly u = {
    matrix: uniform(new THREE.Matrix4()),
    /** 0 off .. 1: how much of the light the shadow removes */
    strength: uniform(0),
    /** world metres per shadow texel; depth range (m) of the map */
    texel: uniform(0.01), range: uniform(60),
    /** angular size of the light (penumbra metres per metre of blocker height) */
    softness: uniform(0.06),
    /** map centre (for the edge fade) and radius (m) */
    centre: uniform(new THREE.Vector3()), radius: uniform(10),
    webgl: uniform(0),
    /** 0 normal; 1 show the map's depth at this point; 2 show the receiver's depth (diagnostics) */
    debug: uniform(0),
  };
  private rt: THREE.RenderTarget;
  private depth: any;
  private dir = new THREE.Vector3(0.2, 1, 0.1).normalize();
  /** casters write their light-space depth (the same matrix the receivers use) into a float colour target */
  private depthMat = new THREE.MeshBasicNodeMaterial();
  private clear = new THREE.Color();
  private node: any = null;
  size: number;
  /** where the map is centred this frame (the game sets it: the player's feet) */
  readonly focus = new THREE.Vector3();

  constructor(size: number) {
    this.size = size;
    this.rt = this.makeTarget(size);
    this.depth = texture(this.rt.texture);
    this.camera.layers.set(CASTER_LAYER);
    const u = this.u as any;
    (this.depthMat as any).colorNode = Fn(() => {
      const clip = u.matrix.mul(vec4(positionWorld, 1.0));
      return vec4(select(u.webgl.greaterThan(0.5), clip.z.div(clip.w).mul(0.5).add(0.5), clip.z.div(clip.w)), 0.0, 0.0, 1.0);
    })();
    this.depthMat.side = THREE.DoubleSide;
    this.depthMat.blending = THREE.NoBlending; // a float red target cannot blend
  }

  private makeTarget(size: number): THREE.RenderTarget {
    const rt = new THREE.RenderTarget(size, size, { depthBuffer: true, type: THREE.FloatType, format: THREE.RedFormat });
    rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  setSize(size: number): void {
    if (size === this.size || size <= 0) return;
    this.size = size;
    const old = this.rt;
    this.rt = this.makeTarget(size);
    this.depth.value = this.rt.texture;
    old.dispose();
  }

  /** The map texture (debug view). */
  get map(): THREE.Texture { return this.rt.texture; }

  /** Put an object (and its children) on the caster layer (it stays visible to every camera it was visible to). */
  static cast(root: THREE.Object3D): void { root.traverse((o) => o.layers.enable(CASTER_LAYER)); }

  /** Aim the light: direction toward the light (world), and how much light it carries relative to the rest (0..1). */
  aim(towardLight: THREE.Vector3, strength: number, dt: number): void {
    const d = towardLight.clone().normalize();
    if (d.y < 0.57) { d.y = 0.57; d.normalize(); } // never below ~35 degrees: long shadows across a lit room read as wrong
    const k = 1 - Math.exp(-dt * 3);
    this.dir.lerp(d, k).normalize();
    const u = this.u as any;
    u.strength.value += (strength - u.strength.value) * k;
  }

  /** Render the casters round `centre` (call once per frame before the frame graph). */
  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, centre: THREE.Vector3, radius = 10): void {
    const u = this.u as any;
    if (u.strength.value < 0.01) return;
    const cam = this.camera;
    const range = 40;
    // snap the centre to whole texels along the light's axes, so the shadow does not crawl as the player moves
    const texel = (2 * radius) / this.size;
    cam.position.copy(centre).addScaledVector(this.dir, range * 0.5);
    cam.up.set(0, 1, 0);
    if (Math.abs(this.dir.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const c = centre.clone().applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    cam.left = c.x - radius; cam.right = c.x + radius; cam.top = c.y + radius; cam.bottom = c.y - radius;
    cam.near = 0.1; cam.far = range;
    cam.coordinateSystem = (renderer as any).coordinateSystem;
    cam.updateProjectionMatrix();
    u.matrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u.texel.value = texel;
    u.range.value = range;
    u.centre.value.copy(centre);
    u.radius.value = radius;
    u.webgl.value = (renderer as any).coordinateSystem === THREE.WebGLCoordinateSystem ? 1 : 0;

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background, prevBgNode = (scene as any).backgroundNode;
    scene.overrideMaterial = this.depthMat;
    scene.background = null;
    (scene as any).backgroundNode = null;
    renderer.getClearColor(this.clear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0xffffff, 1); // nothing in the way: the far plane
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, prevAlpha);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    (scene as any).backgroundNode = prevBgNode;
  }

  /**
   * The shadow factor for the current fragment: 1 = unshadowed, down to 1 - strength in full shadow. One node shared by
   * every baked material.
   */
  factor(): any {
    if (this.node) return this.node;
    const u = this.u as any;
    const depthTex = this.depth;
    this.node = Fn(() => {
      const out = float(1).toVar();
      If(u.strength.greaterThan(0.01), () => {
        // a small offset along the geometric normal keeps a surface from shadowing itself
        const p = positionWorld.add(normalWorldGeometry.mul(u.texel.mul(1.5)));
        const clip = u.matrix.mul(vec4(p, 1.0));
        const ndc = clip.xyz.div(clip.w);
        const uv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(0.5).add(0.5));
        const z = select(u.webgl.greaterThan(0.5), ndc.z.mul(0.5).add(0.5), ndc.z);
        const inside = smoothstep(1.0, 0.85, max(abs(ndc.x), abs(ndc.y))).mul(smoothstep(1.0, 0.98, z));
        // rotation of the Poisson disc per pixel (TAA resolves the noise)
        const ang = interleavedGradientNoise(screenCoordinate.xy).mul(6.2831853);
        const cs = cos(ang), sn = sin(ang);
        const rot = (x: number, y: number) => vec2(cs.mul(x).sub(sn.mul(y)), sn.mul(x).add(cs.mul(y)));
        const texelUV = 1 / this.size;
        const bias = 0.0015;
        // texel fetch (no sampler: the float map is unfilterable, and a fetch is valid in any control flow)
        const last = this.size - 1;
        // `uv` follows three's sampling convention (v up); a fetch indexes the target's own rows: top-down on WebGPU,
        // bottom-up on WebGL (measured by reading the map back)
        const fetchUV = (q: any) => vec2(q.x, select(u.webgl.greaterThan(0.5), q.y, q.y.oneMinus()));
        const vis = float(1).toVar();
        const tap = (o: any) => T.textureLoad(this.rt.texture, T.ivec2(T.clamp(fetchUV(uv.add(o)).mul(this.size), 0.0, last))).r;
        // fetches only where it matters: inside the map, and the filter only where the search found a blocker
        If(inside.greaterThan(0.001), () => {
          // blocker search over ~0.3 m round the point
          const searchR = float(0.3).div(u.texel).mul(texelUV);
          const blockers = float(0).toVar();
          const sumB = float(0).toVar();
          for (const [x, y] of POISSON.slice(0, 8)) {
            const d = tap(rot(x, y).mul(searchR));
            const hit = d.lessThan(z.sub(bias));
            blockers.addAssign(select(hit, float(1), float(0)));
            sumB.addAssign(select(hit, d, float(0)));
          }
          If(blockers.greaterThan(0.0), () => {
            // penumbra (m) grows with the receiver's distance below the blocker (contact hardening); at least ~1.5 texels
            const avgB = sumB.div(blockers);
            const pen = max(z.sub(avgB).mul(u.range).mul(u.softness), u.texel.mul(1.5));
            const filterR = pen.div(u.texel).mul(texelUV);
            const lit = float(0).toVar();
            for (const [x, y] of POISSON) lit.addAssign(select(tap(rot(x, y).mul(filterR)).lessThan(z.sub(bias)), float(0), float(1)));
            vis.assign(lit.div(POISSON.length));
          });
        });
        out.assign(mix(float(1), float(1).sub(u.strength), float(1).sub(vis).mul(inside)));
        If(u.debug.greaterThan(0.5), () => {
          out.assign(select(u.debug.greaterThan(4.5), vis, select(u.debug.greaterThan(3.5), uv.y, select(u.debug.greaterThan(2.5), uv.x,
            select(u.debug.greaterThan(1.5), z, tap(vec2(0.0)))))));
        });
      });
      return out;
    })();
    return this.node;
  }

  dispose(): void {
    this.rt.dispose();
    this.depthMat.dispose();
  }
}

void vec3; void min;

/** The live shadow pass (null when the preset has none): baked materials built while it exists read its factor. */
let active: DynamicShadows | null = null;
export function setActiveShadows(s: DynamicShadows | null): void { active = s; }
export function activeShadowFactor(): any { return active ? active.factor() : null; }
