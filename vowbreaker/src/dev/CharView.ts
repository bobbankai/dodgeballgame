import { Color3, MeshBuilder, Vector3, VertexBuffer } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { Character } from '../game/Character';
import { EnvSettings, envMaterial } from '../render/Env';
import { DUSK } from '../render/Sky';

/** ?view=chars[&who=a,b,c][&clip=name]: characters in a row on a test floor, for checking models. */
export async function charView(r: Renderer, params: URLSearchParams): Promise<(dt: number) => void> {
  const who = (params.get('who') ?? 'itsuki,sayo,mikami,ryoga').split(',');
  const clip = params.get('clip') ?? 'idle_fight';
  r.sky.mood = DUSK;
  const L = r.lighting;
  L.sunDir = new Vector3(-0.5, 0.55, -0.6).normalize();
  L.sunColor = new Color3(1.5, 1.05, 0.75);
  L.skyColor = new Color3(0.35, 0.38, 0.6);
  L.groundColor = new Color3(0.2, 0.16, 0.16);
  L.shadowColor = new Color3(0.45, 0.42, 0.75);
  L.rimColor = new Color3(1.0, 0.7, 0.5);
  const ground = MeshBuilder.CreateGround('floor', { width: 30, height: 30, subdivisions: 2 }, r.scene);
  const n = ground.getTotalVertices();
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) cols.set([0.55, 0.5, 0.46, 14 / 32], i * 4);
  ground.setVerticesData(VertexBuffer.ColorKind, cols);
  const env = new EnvSettings();
  ground.material = envMaterial(r.mats, ground, env);
  r.shadow.addCaster(ground);
  r.gbuffer.add(ground);
  r.shadow.extent = 8;
  const chars: Character[] = [];
  for (let i = 0; i < who.length; i++) {
    const c = await Character.create(r, who[i]);
    c.position.set((i - (who.length - 1) / 2) * 1.4, 0, 0);
    c.yaw = Math.PI;
    c.anim.play(clip, 0);
    chars.push(c);
  }
  const span = Math.max(3.5, who.length * 1.4);
  r.camera.position.set(0.8, 1.3, -span * 0.95);
  r.camera.setTarget(new Vector3(0, 1.0, 0));
  return (dt: number) => {
    for (const c of chars) c.update(dt);
  };
}
