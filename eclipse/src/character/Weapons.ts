import { Color3, Matrix, PBRMaterial, Quaternion, Texture, TransformNode, Vector3, VertexBuffer, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import type { Character } from './Character';
import type { Lighting } from '../render/Lighting';
import { assetUrl } from '../assets/paths';
import { DissolvePlugin } from '../render/materials/FxPlugins';

/** Weapon geometry info used by combat (blade segment in the weapon's local space, metres). */
export interface WeaponSpec {
  id: string;
  /** blade base and tip along local +Y */
  base: number;
  tip: number;
  radius: number;
  /** Glow strength of the weapon's emissive map (0 = none). */
  emissive?: number;
}

export const WEAPONS: Record<string, WeaponSpec> = {
  oathkeeper: { id: 'oathkeeper', base: 0.06, tip: 0.98, radius: 0.06 },
  ashblade: { id: 'ashblade', base: 0.05, tip: 0.83, radius: 0.05 },
  cinder_greatsword: { id: 'cinder_greatsword', base: 0.12, tip: 1.46, radius: 0.07, emissive: 2.6 },
  cinderfall: { id: 'cinderfall', base: 0.12, tip: 1.46, radius: 0.07, emissive: 4 },
  reaver_spear: { id: 'reaver_spear', base: 0.9, tip: 1.78, radius: 0.05 },
  trident: { id: 'trident', base: 1.1, tip: 2.2, radius: 0.1, emissive: 2.5 },
};

const matCache = new Map<string, PBRMaterial>();

function weaponMaterial(scene: Scene, id: string): PBRMaterial {
  let m = matCache.get(id);
  if (m && m.getScene() === scene) return m;
  m = new PBRMaterial(`weapon_${id}`, scene);
  const t = (s: string, srgb: boolean) => {
    const tx = new Texture(assetUrl(`weapons/${id}_${s}.webp`), scene, { invertY: false });
    tx.gammaSpace = srgb;
    tx.anisotropicFilteringLevel = 8;
    return tx;
  };
  m.albedoTexture = t('c', true);
  m.bumpTexture = t('n', false);
  m.invertNormalMapX = !scene.useRightHandedSystem;
  m.invertNormalMapY = scene.useRightHandedSystem;
  m.metallicTexture = t('orm', false);
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = 1;
  const glow = WEAPONS[id]?.emissive ?? 0;
  if (glow > 0) {
    m.emissiveTexture = t('e', true);
    m.emissiveColor = new Color3(glow, glow, glow);
  }
  new DissolvePlugin(m);
  matCache.set(id, m);
  return m;
}

/** Instantiates a weapon model and parents it to a character socket (grip at the socket origin). */
export async function attachWeapon(scene: Scene, assets: AssetManager, c: Character, id: string, socket: string, lighting?: Lighting): Promise<TransformNode> {
  const inst = await assets.instantiate(`weapons/${id}.glb`, `${c.root.name}:${id}`);
  const node = c.socket(socket);
  inst.root.parent = node;
  inst.root.position.setAll(0);
  // the glTF root carries the handedness conversion; keep it, the sword's +Y is the blade
  const mat = weaponMaterial(scene, id);
  for (const m of inst.meshes as AbstractMesh[]) {
    m.material = mat;
    m.receiveShadows = true;
    lighting?.addCaster(m, false);
  }
  return inst.root;
}

/**
 * A tower shield held upright: the grip follows the hand, but the shield stands long side up with its
 * face turned out to the front and the shield side, whatever the fist is doing (the sword clips hold
 * the off hand like a sword hand, which lays a shield flat). The shield moves under a holder that
 * stands in for the socket, so its own transform (export axes included) is untouched; its long and
 * thin axes are measured from its geometry in that frame. `side` is +1 for a left-hand socket
 * (characters face +Z, left is +X).
 */
export function holdUpright(c: Character, shield: TransformNode, socket = 'weapon_l', side = 1, turnOut = 0.5): TransformNode {
  const sock = c.socket(socket);
  // shield geometry in the socket frame, from local transforms (the fresh instance has no world matrices yet)
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (const m of shield.getChildMeshes(false)) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    if (!pos) continue;
    let rel = Matrix.Identity();
    for (let n: TransformNode | null = m; n && n !== sock; n = n.parent as TransformNode | null) rel = rel.multiply(localMatrix(n));
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], rel, v);
      lo.minimizeInPlace(v);
      hi.maximizeInPlace(v);
    }
  }
  const ext = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z];
  const mid = [hi.x + lo.x, hi.y + lo.y, hi.z + lo.z];
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  const axis = (i: number, sgn: number) => new Vector3(i === 0 ? sgn : 0, i === 1 ? sgn : 0, i === 2 ? sgn : 0);
  // long side: toward the longer end from the grip; face: toward the side the plate sits on
  const L = axis(order[0], Math.sign(mid[order[0]]) || 1);
  const N = axis(order[2], Math.sign(mid[order[2]]) || 1);
  const face = new Vector3(side * turnOut, 0, 1).normalize();
  const rot = Matrix.Transpose(basis(L, N)).multiply(basis(new Vector3(0, 1, 0), face));
  const holder = new TransformNode(`${shield.name}:holder`, c.root.getScene());
  holder.parent = c.root;
  holder.rotationQuaternion = Quaternion.FromRotationMatrix(rot);
  shield.parent = holder;
  const inv = new Matrix();
  c.animator.post.push(() => {
    sock.computeWorldMatrix(true);
    c.root.getWorldMatrix().invertToRef(inv);
    Vector3.TransformCoordinatesToRef(sock.getAbsolutePosition(), inv, holder.position);
  });
  return holder;
}

function localMatrix(n: TransformNode): Matrix {
  const q = n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation);
  return Matrix.Compose(n.scaling, q, n.position);
}

/** Rotation whose rows (Babylon's row-vector convention) are X = Y x Z, Y = up, Z = face. */
function basis(up: Vector3, face: Vector3): Matrix {
  const y = up.normalizeToNew();
  const z = face.subtract(y.scale(Vector3.Dot(face, y))).normalize();
  const x = Vector3.Cross(y, z).normalize();
  return Matrix.FromValues(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1);
}
