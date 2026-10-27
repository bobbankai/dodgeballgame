import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { G } from '../render/Globals';
import { SketchLines, type Segments } from '../render/Sketch';
import type { Game } from './Game';

const DROPS = 260;

/**
 * Weather: pencilled rain slanting past the camera, lightning bolts inked across the sky with a
 * flash and thunder, the sea's swell rising and the light going grey. `level` 0..1 eases it in.
 */
export class Storm {
  level = 0;
  target = 0;
  private rain: SketchLines;
  private rseg: Segments;
  private drops: THREE.Vector3[] = [];
  private bolt: SketchLines;
  private bseg: Segments;
  private boltLife = 0;
  private nextBolt = 4;
  private flash = 0;
  private base = { sun: 1, sky: new THREE.Color(), ambient: new THREE.Color(), fog: new THREE.Vector3() };

  constructor(private game: Game) {
    this.rseg = { a: new Float32Array(DROPS * 3), b: new Float32Array(DROPS * 3), seed: new Float32Array(DROPS * 2), count: DROPS };
    for (let i = 0; i < DROPS; i++) {
      this.drops.push(new THREE.Vector3((Math.random() - 0.5) * 30, Math.random() * 14, (Math.random() - 0.5) * 30));
      this.rseg.seed[i * 2] = Math.random() * 100;
      this.rseg.seed[i * 2 + 1] = 2;
    }
    this.rain = new SketchLines(this.rseg, { width: 1.1, wobble: 0, color: 0x9aa4b4, alpha: 0 });
    const nb = 40;
    this.bseg = { a: new Float32Array(nb * 3), b: new Float32Array(nb * 3), seed: new Float32Array(nb * 2), count: 0 };
    this.bolt = new SketchLines(this.bseg, { width: 3.2, wobble: 0.05, color: 0xfffbe8, alpha: 0 });
    this.bolt.progress = 1;
    for (let i = 0; i < nb; i++) this.bseg.seed[i * 2 + 1] = 0;
    game.pipe.overlay.add(this.rain, this.bolt);
  }

  /** Remember the calm-weather lighting to blend back to. */
  captureBase() {
    const g = this.game;
    this.base.sun = g.sun.intensity;
    this.base.sky.copy(g.pipe.uniforms.uSkyTop.value);
    this.base.ambient.copy(G.uAmbient.value);
    this.base.fog.copy(G.uFog.value);
  }

  private strike() {
    const cam = this.game.camera.position;
    const yaw = Math.random() * Math.PI * 2;
    const start = new THREE.Vector3(cam.x + Math.sin(yaw) * 45, 40, cam.z + Math.cos(yaw) * 45);
    const s = this.bseg;
    let p = start.clone();
    let k = 0;
    while (p.y > 0 && k < 30) {
      const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, -2.5 - Math.random() * 2.5, (Math.random() - 0.5) * 6));
      s.a.set([p.x, p.y, p.z], k * 3);
      s.b.set([q.x, q.y, q.z], k * 3);
      s.seed[k * 2] = Math.random() * 100;
      s.seed[k * 2 + 1] = 0;
      k++;
      // a fork now and then
      if (Math.random() < 0.15 && k < 29) {
        const f = q.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -3, (Math.random() - 0.5) * 8));
        s.a.set([q.x, q.y, q.z], k * 3);
        s.b.set([f.x, f.y, f.z], k * 3);
        s.seed[k * 2] = Math.random() * 100;
        k++;
      }
      p = q;
    }
    s.count = k;
    this.bolt.setSegments(s);
    this.boltLife = 0.35;
    this.flash = 1;
    const dist = Math.random();
    window.setTimeout(() => audio.thunder(), 300 + dist * 1500);
  }

  update(dt: number) {
    const g = this.game;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt * 0.6));
    const L = this.level;
    G.uStorm.value = L;
    // the light goes grey and close
    this.flash = Math.max(0, this.flash - dt * 5);
    const f = this.flash > 0.6 || (this.flash > 0.2 && this.flash < 0.35) ? 1 : 0;
    g.sun.intensity = THREE.MathUtils.lerp(this.base.sun, 0.35, L) + f * 2.0;
    g.pipe.uniforms.uSkyTop.value.copy(this.base.sky).lerp(new THREE.Color(0.42, 0.44, 0.5), L);
    G.uAmbient.value.copy(this.base.ambient).lerp(new THREE.Color(0.36, 0.38, 0.46), L);
    G.uFog.value.set(THREE.MathUtils.lerp(this.base.fog.x, 18, L), THREE.MathUtils.lerp(this.base.fog.y, 85, L), this.base.fog.z);
    // rain: streaks fall and slant past the camera, re-pencilled on the boil
    this.rain.alpha = L * 0.7;
    if (L > 0.02) {
      const cam = g.camera.position;
      const wind = new THREE.Vector3(3, -14, 1.5);
      for (let i = 0; i < DROPS; i++) {
        const d = this.drops[i];
        d.addScaledVector(wind, dt);
        if (d.y < -2) d.set((Math.random() - 0.5) * 30, 12 + Math.random() * 4, (Math.random() - 0.5) * 30);
        const x = cam.x + d.x, y = cam.y + d.y - 4, z = cam.z + d.z;
        this.rseg.a.set([x, y, z], i * 3);
        this.rseg.b.set([x + wind.x * 0.05, y + wind.y * 0.05, z + wind.z * 0.05], i * 3);
      }
      this.rain.setSegments(this.rseg);
      this.nextBolt -= dt;
      if (this.nextBolt <= 0 && L > 0.6) {
        this.strike();
        this.nextBolt = 4 + Math.random() * 6;
      }
    }
    this.boltLife -= dt;
    this.bolt.alpha = this.boltLife > 0 ? 1 : 0;
  }
}
