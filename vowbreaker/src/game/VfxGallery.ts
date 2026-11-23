import { Vector3 } from '@babylonjs/core';
import type { Director } from '../story/Director';
import { PAL } from './Effects';
import { VK, type VfxSpec } from '../render/Vfx';

type Demo = { name: string; life: number; make: (at: Vector3) => Omit<VfxSpec, 'life'> };

const P = (i: number) => {
  const p = PAL[i];
  return { body: p.body, core: p.core, edge: p.edge };
};
const up = (at: Vector3, y: number) => at.add(new Vector3(0, y, 0));

/** One demo per effect kind (and the main styles), for `?vfx=<stage>`. */
export const DEMOS: Demo[] = [
  { name: 'slash energy', life: 0.5, make: (at) => ({ kind: VK.slash, pos: up(at, 0.4), dir: new Vector3(Math.sin(0.4), Math.cos(0.4), 0), up: new Vector3(0, 0, -1), scale: 1.8, color: P(0), intensity: 1.5, p: [0, 0.9, 0.6, 0.2] }) },
  { name: 'slash ink', life: 0.6, make: (at) => ({ kind: VK.slash, pos: up(at, 0.4), dir: new Vector3(Math.sin(-0.5), Math.cos(-0.5), 0), up: new Vector3(0, 0, -1), scale: 1.8, color: P(6), p: [1, 0.9, 0.5, 0.2] }) },
  { name: 'slash paper', life: 0.6, make: (at) => ({ kind: VK.slash, pos: up(at, 0.4), dir: new Vector3(Math.sin(0.2), Math.cos(0.2), 0), up: new Vector3(0, 0, -1), scale: 1.8, color: P(1), p: [2, 0.9, 0.2, 0.25] }) },
  { name: 'slash water', life: 0.6, make: (at) => ({ kind: VK.slash, pos: up(at, 0.4), dir: new Vector3(Math.sin(-0.2), Math.cos(-0.2), 0), up: new Vector3(0, 0, -1), scale: 1.8, color: P(2), p: [3, 0.9, 0.4, 0.2] }) },
  { name: 'shock dome', life: 0.6, make: (at) => ({ kind: VK.shockDome, pos: up(at, 1), scale: 0.5, grow: 3, color: P(3), intensity: 1.2, p: [5, 0, 0.8, 0], q: [0, 0, 0, 0] }) },
  { name: 'dust dome', life: 0.8, make: (at) => ({ kind: VK.shockDome, pos: up(at, 0.3), scale: 0.6, grow: 2.6, color: P(0), p: [3, 0, 1, 0], q: [1, 0, 0, 0], shape: 'dome' }) },
  { name: 'ground ring', life: 0.7, make: (at) => ({ kind: VK.groundRing, pos: up(at, 0.03), scale: 1.5, color: P(4), intensity: 1.4, p: [0.06, 0, 0.5, 0] }) },
  { name: 'dust ring', life: 0.9, make: (at) => ({ kind: VK.groundRing, pos: up(at, 0.03), scale: 1.5, color: P(0), p: [0.08, 0, 0, 0], q: [1, 0, 0, 0] }) },
  { name: 'crater', life: 3, make: (at) => ({ kind: VK.crater, pos: up(at.add(new Vector3(1.2, 0, 0)), 0.03), scale: 1.4, color: P(3) }) },
  { name: 'bell', life: 1.6, make: (at) => ({ kind: VK.bell, pos: up(at, 0.2), scale: new Vector3(1.0, 1.4, 1.0), color: P(0), intensity: 1.2, p: [1, 0.6, 0, 0] }) },
  { name: 'flame', life: 1.6, make: (at) => ({ kind: VK.flame, pos: at, scale: new Vector3(0.6, 2.2, 0.6), color: P(3), intensity: 1.3, p: [0, 1, 1.4, 0.6] }) },
  { name: 'black fire', life: 1.6, make: (at) => ({ kind: VK.flame, pos: at, scale: new Vector3(0.6, 2.2, 0.6), color: P(6), p: [1, 1, 1.4, 0.6] }) },
  { name: 'aura', life: 2, make: (at) => ({ kind: VK.aura, pos: up(at, 0.95), scale: new Vector3(0.55, 1.05, 0.55), color: P(4), intensity: 1.2, p: [1, 1.2, 0, 0] }) },
  { name: 'firenado', life: 2, make: (at) => ({ kind: VK.firenado, pos: at, scale: new Vector3(1.0, 3.0, 1.0), color: P(3), intensity: 1.2 }) },
  { name: 'bolt', life: 0.6, make: (at) => ({ kind: VK.bolt, pos: up(at, 2.6), dir: new Vector3(0.2, -1, 0), scale: new Vector3(0.8, 1, 2.6), color: P(2), intensity: 1.5, p: [0, 0.8, 0.6, 0.12] }) },
  { name: 'black spark', life: 0.6, make: (at) => ({ kind: VK.bolt, pos: up(at, 2.4), dir: new Vector3(-0.3, -1, 0), scale: new Vector3(0.9, 1, 2.4), color: P(5), p: [1, 0.9, 0.8, 0.14] }) },
  { name: 'arcs', life: 1.5, make: (at) => ({ kind: VK.arcs, pos: up(at, 1.1), scale: 0.6, color: P(2), intensity: 1.4 }) },
  { name: 'beam', life: 1.2, make: (at) => ({ kind: VK.beam, pos: up(at.add(new Vector3(-1.2, 0, 0)), 1.1), dir: new Vector3(1, 0.05, 0), scale: new Vector3(0.6, 1, 2.6), color: P(4), intensity: 1.3, p: [6, 1, 0, 0] }) },
  { name: 'moon column', life: 1.6, make: (at) => ({ kind: VK.column, pos: at, scale: new Vector3(0.9, 6, 0.9), color: P(2), intensity: 1.2 }) },
  { name: 'pillar', life: 1.4, make: (at) => ({ kind: VK.pillar, pos: at, scale: new Vector3(0.8, 3, 0.8), color: P(0), intensity: 1.2 }) },
  { name: 'curse pillar', life: 1.4, make: (at) => ({ kind: VK.pillar, pos: at, scale: new Vector3(0.8, 3, 0.8), color: P(6), q: [0, 1, 0, 0] }) },
  { name: 'smoke', life: 1.6, make: (at) => ({ kind: VK.smoke, pos: up(at, 0.8), scale: 0.8, grow: 1.4, color: P(0), p: [0.2, 0, 0, 0] }) },
  { name: 'ink', life: 2.5, make: (at) => ({ kind: VK.ink, pos: up(at, 0.03), scale: 1.4, color: P(6), p: [0, 9, 1, 0] }) },
  { name: 'paper storm', life: 2, make: (at) => ({ kind: VK.paper, pos: at, scale: new Vector3(1.1, 2.6, 1.1), color: P(1), p: [14, 1.2, 1, 0] }) },
  { name: 'splash', life: 1.2, make: (at) => ({ kind: VK.splash, pos: at, scale: new Vector3(0.8, 1.1, 0.8), color: P(2), flare: 1.1 }) },
  { name: 'tendril', life: 2, make: (at) => ({ kind: VK.tendril, pos: at, dir: new Vector3(0.2, 1, 0), scale: new Vector3(0.5, 1, 2.6), color: P(6) }) },
  { name: 'crane trail', life: 2, make: (at) => ({ kind: VK.crane, pos: up(at.add(new Vector3(-1.2, 0, 0)), 1.2), dir: new Vector3(1, 0.2, 0), scale: new Vector3(0.5, 1, 2.6), color: P(1) }) },
  { name: 'seal', life: 2, make: (at) => ({ kind: VK.seal, pos: up(at, 0.04), scale: 1.4, color: P(0), intensity: 1.2, p: [0, 1, 0.6, 0] }) },
  { name: 'portal', life: 2, make: (at) => ({ kind: VK.portal, pos: up(at, 1.3), scale: 2.4, color: P(4), billboard: 1, p: [4, 0.5, 0, 0] }) },
  { name: 'gravity', life: 2, make: (at) => ({ kind: VK.gravity, pos: up(at, 1.2), scale: 0.8, color: P(4), intensity: 1.2 }) },
  { name: 'veil', life: 2.5, make: (at) => ({ kind: VK.veil, pos: at, scale: 1.4, color: P(6), intensity: 1 }) },
  { name: 'claw', life: 0.6, make: (at) => ({ kind: VK.claw, pos: up(at, 1.2), scale: 1.8, color: P(6), intensity: 1.4, p: [4, 0, 0, 0] }) },
  { name: 'thrust', life: 0.5, make: (at) => ({ kind: VK.thrust, pos: up(at.add(new Vector3(-1.2, 0, 0)), 1.1), dir: new Vector3(1, 0, 0), scale: new Vector3(0.5, 1, 2.6), color: P(3), intensity: 1.4 }) },
  { name: 'cross cut', life: 0.6, make: (at) => ({ kind: VK.crosscut, pos: up(at, 1.2), scale: 2.2, color: P(1), intensity: 1.4 }) },
];

/**
 * The effects gallery: every kind on a grid in front of a still camera, replayed on a loop.
 * `window.__gallery.freeze(t)` holds every effect at the fraction t of its life (for stills).
 */
export async function vfxGallery(d: Director, stage: string, only?: string): Promise<void> {
  await d.setStage(stage);
  const list = only ? DEMOS.filter((x) => only.split(',').some((o) => x.name.includes(o))) : DEMOS;
  const cols = Math.min(list.length, 7);
  const rows = Math.ceil(list.length / cols);
  const gap = 3.4;
  const spots = list.map((_, i) => new Vector3((i % cols - (cols - 1) / 2) * gap, 0, (Math.floor(i / cols) - (rows - 1) / 2) * gap * 1.2));
  const depth = rows * gap * 1.2;
  d.shot([0, 3.5 + depth * 0.45 + cols * 0.35, -(depth * 0.5 + 3 + cols * 1.45)], [0, 0.9, 0], 0.75);
  const vfx = d.fx.vfx;
  let timer = 0;
  const play = () => {
    vfx.clear();
    list.forEach((demo, i) => vfx.spawn({ ...demo.make(spots[i]), life: demo.life } as VfxSpec));
  };
  play();
  const g = {
    names: list.map((x) => x.name),
    freeze: (t: number | null) => { vfx.debugAge = t; },
    replay: play,
  };
  (window as unknown as { __gallery: typeof g }).__gallery = g;
  d.r.scene.onBeforeRenderObservable.add(() => {
    timer += d.r.scene.getEngine().getDeltaTime() / 1000;
    if (timer > 3.2 && vfx.debugAge === null) {
      timer = 0;
      play();
    }
  });
}
