// Things that last a moment: sparks, shock rings, dust, rain, and the kick the whole picture takes on a big hit.
import {
  Color4, DynamicTexture, GPUParticleSystem, IParticleSystem, Matrix, ParticleSystem, PostProcess, Scene, Texture, Vector2, Vector3,
} from '@babylonjs/core';
import { Gfx } from './gfx';
import { effectPass } from './sl';

function sprite(scene: Scene, name: string, draw: (c: CanvasRenderingContext2D, s: number) => void, size = 64): Texture {
  const t = new DynamicTexture(name, size, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, size, size);
  draw(c, size);
  t.update(false);
  t.hasAlpha = true;
  return t;
}

const SCREEN = `
varying vUV: V2;
sampler textureSampler;
uniform fx: V4;
uniform centre: V2;
@fragment {
  let d: V2 = IN.vUV - U.centre;
  var c: V3 = V3(0.0, 0.0, 0.0);
  for (var i: I = 0; i < 6; i++) {
    let uv: V2 = U.centre + d * (1.0 - U.fx.x * F(i) * 0.022);
    let off: V2 = d * U.fx.y * 0.014;
    c += V3(TEX(textureSampler, uv + off).r, TEX(textureSampler, uv).g, TEX(textureSampler, uv - off).b);
  }
  c = c / 6.0;
  let l: F = dot(c, V3(0.299, 0.587, 0.114));
  c = mix(c, V3(l, l, l) * V3(1.04, 1.0, 0.94), U.fx.w);
  c = c * (1.0 - U.fx.z * dot(d, d) * 1.7);
  COLOR = V4(c, 1.0);
}`;

export class Vfx {
  private sparks: ParticleSystem; private ring: ParticleSystem; private dust: ParticleSystem; private drops: ParticleSystem;
  private rainSys: IParticleSystem | null = null; private splash: ParticleSystem | null = null;
  private pass: PostProcess | null = null;
  /** zoom blur, colour split: kicked by hits, decay on their own */ blur = 0; split = 0;
  /** steady state set by the director: vignette 0..1, desaturation 0..1 */ vignette = 0.35; grey = 0;
  centre = new Vector2(0.5, 0.5);

  constructor(private g: Gfx) {
    const scene = g.scene;
    const glow = sprite(scene, 'glow', (c, s) => {
      const gr = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,210,0.7)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = gr; c.fillRect(0, 0, s, s);
    });
    const ringT = sprite(scene, 'ring', (c, s) => {
      const gr = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.72, 'rgba(255,250,235,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, s, s);
    }, 128);
    const puff = sprite(scene, 'puff', (c, s) => {
      for (let i = 0; i < 9; i++) {
        const x = s * (0.3 + 0.4 * Math.random()), y = s * (0.3 + 0.4 * Math.random()), r = s * (0.18 + 0.14 * Math.random());
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr; c.fillRect(0, 0, s, s);
      }
    }, 128);
    const mk = (name: string, cap: number, tex: Texture, add: boolean) => {
      const p = new ParticleSystem(name, cap, scene);
      p.particleTexture = tex; p.emitter = new Vector3(0, 1, 0); p.emitRate = 0; p.updateSpeed = 1 / 60;
      p.blendMode = add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
      p.minEmitBox.set(-0.03, -0.03, -0.03); p.maxEmitBox.set(0.03, 0.03, 0.03);
      p.start();
      return p;
    };
    const s = this.sparks = mk('sparks', 300, glow, true);
    s.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    s.minSize = 0.012; s.maxSize = 0.035; s.minLifeTime = 0.12; s.maxLifeTime = 0.32; s.minEmitPower = 3; s.maxEmitPower = 9;
    s.gravity.set(0, -9, 0); s.color1 = new Color4(6, 4.2, 2.2, 1); s.color2 = new Color4(5, 2.4, 0.8, 1); s.colorDead = new Color4(1, 0.2, 0, 0);
    const r = this.ring = mk('ring', 12, ringT, true);
    r.minLifeTime = r.maxLifeTime = 0.22; r.minEmitPower = r.maxEmitPower = 0;
    r.addSizeGradient(0, 0.12); r.addSizeGradient(1, 1.3);
    r.addColorGradient(0, new Color4(3.5, 3.2, 2.6, 1)); r.addColorGradient(1, new Color4(1, 0.8, 0.5, 0));
    const d = this.dust = mk('dust', 80, puff, false);
    d.minSize = 0.25; d.maxSize = 0.6; d.minLifeTime = 0.5; d.maxLifeTime = 1.1; d.minEmitPower = 0.3; d.maxEmitPower = 1.1;
    d.direction1.set(-1, 0.3, -0.4); d.direction2.set(1, 0.9, 0.4); d.gravity.set(0, 0.2, 0);
    d.color1 = new Color4(0.55, 0.52, 0.5, 0.3); d.color2 = new Color4(0.4, 0.38, 0.36, 0.2); d.colorDead = new Color4(0.4, 0.4, 0.4, 0);
    const w = this.drops = mk('drops', 200, glow, false);
    w.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    w.minSize = 0.008; w.maxSize = 0.02; w.minLifeTime = 0.25; w.maxLifeTime = 0.6; w.minEmitPower = 1.5; w.maxEmitPower = 5; w.gravity.set(0, -9.8, 0);
    w.color1 = new Color4(0.9, 0.95, 1, 0.75); w.color2 = new Color4(0.8, 0.9, 1, 0.5); w.colorDead = new Color4(0.8, 0.9, 1, 0);
    if (g.quality !== 'low') {
      this.pass = effectPass(g.camera, 'tbScreen', SCREEN, ['fx', 'centre']);
      this.pass.onApply = (e) => { e.setFloat4('fx', this.blur, this.split, this.vignette, this.grey); e.setVector2('centre', this.centre); };
    }
  }

  /** dir: +1 if the blow travels towards +X. sweat: 0..1 how much flies off the one hit. */
  hit(at: Vector3, power: number, dir: number, kind: 'hit' | 'block' | 'big' = 'hit', sweat = 0.5) {
    const s = this.sparks;
    (s.emitter as Vector3).copyFrom(at);
    s.direction1.set(dir * 0.2, -0.6, -0.8); s.direction2.set(dir * 1.6, 1.1, 0.8);
    if (kind === 'block') { s.color1.set(2.2, 2.8, 4, 1); s.color2.set(1.2, 1.8, 3, 1); s.manualEmitCount = 8; }
    else { s.color1.set(6, 4.2, 2.2, 1); s.color2.set(5, 2.4, 0.8, 1); s.manualEmitCount = Math.round(10 + 26 * power); }
    (this.ring.emitter as Vector3).copyFrom(at);
    this.ring.manualEmitCount = kind === 'big' ? 2 : 1;
    if (kind !== 'block' && sweat > 0) {
      (this.drops.emitter as Vector3).copyFrom(at);
      this.drops.direction1.set(dir * 0.3, 0.2, -1); this.drops.direction2.set(dir * 2.2, 1.6, 1);
      this.drops.manualEmitCount = Math.round(sweat * (8 + 22 * power));
    }
    const sp = Vector3.Project(at, Matrix.IdentityReadOnly, this.g.scene.getTransformMatrix(), this.g.camera.viewport);
    this.centre.set(sp.x, 1 - sp.y);
    this.split = Math.max(this.split, kind === 'block' ? 0.25 : 0.5 + power);
    if (kind === 'big') this.blur = 1;
  }

  puff(x: number, n = 6) {
    (this.dust.emitter as Vector3).set(x, 0.05, 0);
    this.dust.manualEmitCount = n;
  }

  /** Rain that follows the camera, with splashes on the floor. amount 0 stops it. */
  rain(amount: number) {
    const scene = this.g.scene, cap = Math.round(this.g.tier.rain * amount);
    this.rainSys?.dispose(); this.splash?.dispose();
    this.rainSys = null; this.splash = null;
    if (cap <= 0) return;
    const streak = sprite(scene, 'streak', (c, s) => {
      const gr = c.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(235,242,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(s * 0.4, 0, s * 0.2, s);
    }, 32);
    const p: ParticleSystem | GPUParticleSystem = GPUParticleSystem.IsSupported ? new GPUParticleSystem('rain', { capacity: cap }, scene) : new ParticleSystem('rain', Math.min(cap, 1500), scene);
    p.particleTexture = streak;
    p.emitter = new Vector3(0, 9, 0);
    p.minEmitBox.set(-11, 0, -9); p.maxEmitBox.set(11, 0, 6);
    p.direction1.set(-1.3, -16, -0.6); p.direction2.set(-1.9, -19, -0.2);
    p.minEmitPower = p.maxEmitPower = 1; p.minLifeTime = 0.5; p.maxLifeTime = 0.58;
    p.minSize = 0.5; p.maxSize = 0.9; p.minScaleX = 0.018; p.maxScaleX = 0.03;
    p.emitRate = cap / 0.56; p.updateSpeed = 1 / 60;
    p.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    p.color1 = new Color4(0.75, 0.82, 0.95, 0.3); p.color2 = new Color4(0.6, 0.7, 0.9, 0.18); p.colorDead = new Color4(0.6, 0.7, 0.9, 0.1);
    p.blendMode = ParticleSystem.BLENDMODE_ADD;
    p.start();
    this.rainSys = p;
    const ringT = sprite(scene, 'drip', (c, s) => {
      c.strokeStyle = 'rgba(230,240,255,0.9)'; c.lineWidth = s * 0.07; c.beginPath(); c.arc(s / 2, s / 2, s * 0.36, 0, 7); c.stroke();
    });
    const sp = this.splash = new ParticleSystem('splash', 160, scene);
    sp.particleTexture = ringT; sp.emitter = new Vector3(0, 0.012, 0);
    sp.minEmitBox.set(-8, 0, -4); sp.maxEmitBox.set(8, 0, 2.5);
    sp.isBillboardBased = false;                    // rings lie flat on the floor
    sp.minInitialRotation = sp.maxInitialRotation = 0;
    sp.direction1.set(0, 0, 0); sp.direction2.set(0, 0, 0); sp.minEmitPower = sp.maxEmitPower = 0;
    sp.minLifeTime = 0.25; sp.maxLifeTime = 0.4; sp.emitRate = 220 * amount; sp.updateSpeed = 1 / 60;
    sp.addSizeGradient(0, 0.02); sp.addSizeGradient(1, 0.22);
    sp.addColorGradient(0, new Color4(0.8, 0.9, 1, 0.5)); sp.addColorGradient(1, new Color4(0.8, 0.9, 1, 0));
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.start();
  }

  update(dt: number, focusX: number) {
    this.blur = Math.max(0, this.blur - dt * 4.5);
    this.split = Math.max(0, this.split - dt * 4);
    if (this.rainSys) (this.rainSys.emitter as Vector3).x = focusX;
    if (this.splash) (this.splash.emitter as Vector3).x = focusX;
  }
}
