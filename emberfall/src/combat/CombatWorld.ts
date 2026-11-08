// The combat systems that live in the world rather than on a fighter: projectiles in flight, burning
// ground, and the combat log. This is the game-side host for the pure ProjectileSystem and Hazards: it
// supplies the collision world and the fighters, draws the pots, arrows and bolts of black flame and the
// pools of burning oil, and plays the impacts.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Combatant, HitResult } from '../game/Combat';
import { ProjectileSystem, type Projectile } from './Projectiles';
import { Hazards, HAZARDS, type HazardTarget, type Zone } from './Hazards';
import { CombatLog } from './DamageModel';

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const POOL_FRAG = /* glsl */ `
uniform float uTime, uStrength, uSeed;
uniform vec3 uColor;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  // a ragged edge and licking tongues of flame across the oil
  float edge = 0.78 + 0.18 * n(c * 3.0 + uSeed);
  float body = smoothstep(edge, edge - 0.25, r);
  float flick = n(c * 5.0 + vec2(uTime * 1.7, -uTime * 2.3) + uSeed) * 0.6 + n(c * 11.0 - uTime * 3.1) * 0.4;
  float hot = body * (0.35 + 0.65 * flick) * uStrength;
  vec3 col = mix(uColor * 0.35, uColor * 1.6, flick) * hot;
  gl_FragColor = vec4(col, hot * 0.85);
}`;

interface PoolView { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; fire: { on: boolean }; smoke: { on: boolean }; light: ReturnType<Game['light']> }

export class CombatWorld {
  readonly projectiles: ProjectileSystem;
  readonly hazards = new Hazards();
  readonly log = new CombatLog();
  private group = new THREE.Group();
  private potGeo = new THREE.SphereGeometry(0.13, 12, 8);
  private arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6).rotateX(Math.PI / 2);
  private boltGeo = new THREE.SphereGeometry(0.22, 14, 10);
  private poolGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private potMat: THREE.MeshStandardMaterial;
  private arrowMat: THREE.MeshStandardMaterial;
  private boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.0, 0.02) });
  private targetsTmp: HazardTarget[] = [];

  constructor(private game: Game) {
    const lit = (m: THREE.MeshStandardMaterial) => { game.pipe.lighting.setupMaterial(m); return m; };
    this.potMat = lit(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.32, 0.22, 0.14), roughness: 0.75, emissive: new THREE.Color(0.6, 0.18, 0.02), emissiveIntensity: 0.6 }));
    this.arrowMat = lit(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.35, 0.27, 0.18), roughness: 0.7 }));
    this.group.name = 'combat-world';
    game.pipe.scene.add(this.group);
    const w = game.world;
    this.projectiles = new ProjectileSystem({
      raycast: (o, d, far) => w.raycast(o, d, far),
      targets: (team) => (team === 'enemy' ? (game.player ? [game.player] : []) : game.enemies.filter((e) => !e.dead)) as Combatant[],
      spawned: (p) => this.spawnView(p),
      removed: (p) => { const m = p.view as THREE.Object3D | undefined; if (m) this.group.remove(m); },
      impact: (p, at, target, res) => this.impact(p, at, target, res),
      reflected: (p) => {
        game.particles.burst('spark', p.pos, 30, p.vel.clone().normalize());
        game.audio.sfx('parry', p.pos, 0.9);
        game.time.slowmo(0.4, 0.25);
      },
    });
    this.hazards.onAdd = (z) => this.addPoolView(z);
    this.hazards.onRemove = (z) => this.removePoolView(z);
  }

  private spawnView(p: Projectile): void {
    const mesh = new THREE.Mesh(p.kind === 'arrow' ? this.arrowGeo : p.kind === 'blackfire' ? this.boltGeo : this.potGeo, p.kind === 'arrow' ? this.arrowMat : p.kind === 'blackfire' ? this.boltMat : this.potMat);
    mesh.castShadow = p.kind !== 'blackfire';
    mesh.position.copy(p.pos);
    p.view = mesh;
    this.group.add(mesh);
  }

  private impact(p: Projectile, at: THREE.Vector3, target: Combatant | null, res: HitResult | null): void {
    const g = this.game;
    const pr = g.particles;
    if (target && res) {
      this.log.add(g.gameTime, p.owner?.name ?? '?', target.name, res === 'hit' || res === 'killed' ? p.spec.damage : 0, p.spec.type);
      if (target === (g.player as Combatant) && (res === 'hit' || res === 'killed')) {
        g.cam.addTrauma(0.35);
        g.pipe.grade.damage = Math.min(1, g.pipe.grade.damage + 0.6);
      }
    }
    switch (p.kind) {
      case 'firepot':
        if (target && res !== null) return; // the splash pass reports each victim; effects play once on landing
        pr.burst('fire', at, 34, new THREE.Vector3(0, 1, 0), 1.2);
        pr.burst('ember', at, 30, new THREE.Vector3(0, 1, 0));
        pr.burst('smoke', at, 5, new THREE.Vector3(0, 1, 0));
        pr.burst('flash', at, 1, undefined, 1.4);
        g.audio.sfx('wood_break', at, 0.7);
        g.audio.sfx('ignite', at, 0.9);
        {
          const flash = g.light({ position: at.clone().setY(at.y + 0.6), color: new THREE.Color(1, 0.5, 0.15), intensity: 30, distance: 9, priority: 1 });
          window.setTimeout(() => g.pipe.lighting.remove(flash), 120);
        }
        if (p.spec.pool) {
          const gy = g.world.ground(at.x, at.y + 1.5, at.z, 4) ?? at.y;
          this.hazards.add(HAZARDS.oil, new THREE.Vector3(at.x, gy, at.z), p.spec.pool.radius, p.spec.pool.time);
        }
        break;
      case 'blackfire':
        pr.burst('hexfire', at, 40, undefined, 1.3);
        pr.burst('blackfire', at, 24, new THREE.Vector3(0, 1, 0), 1.2);
        g.audio.sfx('burst', at, 0.8);
        break;
      case 'arrow':
        pr.burst('spark', at, 6, p.vel.clone().normalize().negate());
        g.audio.sfx('thud', at, 0.5);
        break;
    }
  }

  private addPoolView(z: Zone): void {
    const g = this.game;
    const mat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uSeed: { value: Math.random() * 50 }, uColor: { value: new THREE.Color(2.4, 0.75, 0.15) } },
    });
    const mesh = new THREE.Mesh(this.poolGeo, mat);
    mesh.position.copy(z.pos).setY(z.pos.y + 0.04);
    mesh.scale.setScalar(z.radius);
    mesh.renderOrder = 50;
    mesh.userData.noCollide = true;
    this.group.add(mesh);
    const fire = g.particles.emitter('fire', z.pos.clone().setY(z.pos.y + 0.15), 16 * z.radius, z.radius * 0.7);
    const smoke = g.particles.emitter('smoke', z.pos.clone().setY(z.pos.y + 1.2), 3, z.radius * 0.5, new THREE.Vector3(0, 1, 0));
    const light = g.light({ position: z.pos.clone().setY(z.pos.y + 0.8), color: new THREE.Color(1, 0.45, 0.12), intensity: 14, distance: 8, flicker: 0.5 });
    g.pipe.haze.sources.push({ pos: z.pos.clone().setY(z.pos.y + 0.6), radius: z.radius, strength: 0.6 });
    z.view = { mesh, mat, fire, smoke, light } satisfies PoolView;
  }

  private removePoolView(z: Zone): void {
    const v = z.view as PoolView | undefined;
    if (!v) return;
    this.group.remove(v.mesh);
    v.mat.dispose();
    v.fire.on = false;
    v.smoke.on = false;
    this.game.pipe.lighting.remove(v.light);
    const hs = this.game.pipe.haze.sources;
    const i = hs.findIndex((s) => s.pos.distanceTo(z.pos.clone().setY(z.pos.y + 0.6)) < 0.01);
    if (i >= 0) hs.splice(i, 1);
  }

  update(dt: number): void {
    const g = this.game;
    this.projectiles.update(dt);
    // keep the meshes on their projectiles and trail smoke or flame behind them
    for (const p of this.projectiles.list) {
      const m = p.view as THREE.Mesh | undefined;
      if (!m) continue;
      m.position.copy(p.pos);
      if (p.kind === 'arrow') m.lookAt(p.pos.clone().add(p.vel));
      else m.rotation.x += dt * 9;
      if (p.kind === 'firepot' && Math.random() < 0.6) g.particles.burst('fire', p.pos, 1, undefined, 0.5);
      if (p.kind === 'blackfire') { g.particles.burst('hexfire', p.pos, 2, undefined, 0.8); if (Math.random() < 0.5) g.particles.burst('blackfire', p.pos, 1, undefined, 0.6); }
    }
    // hazards burn whoever stands in them
    const T = this.targetsTmp;
    T.length = 0;
    const pl = g.player;
    if (pl) T.push({ body: pl.body, dead: pl.dead, afflict: (k, a, l) => pl.status.apply(k, a, l) });
    for (const e of g.enemies) if (!e.dead) T.push({ body: e.body, dead: e.dead, afflict: (k, a, l) => e.status.apply(k, a, l) });
    this.hazards.update(dt, T);
    for (const z of this.hazards.zones) {
      const v = z.view as PoolView | undefined;
      if (!v) continue;
      v.mat.uniforms.uTime.value = g.gameTime;
      const s = this.hazards.strength(z);
      v.mat.uniforms.uStrength.value = s;
      v.light.intensity = 14 * s;
    }
  }

  clear(): void {
    this.projectiles.clear();
    this.hazards.clear();
    this.log.clear();
  }
}
