// Fixes for Babylon.js behaviour this game depends on. Imported once by the renderer.
import { ShaderMaterial } from '@babylonjs/core';
import type { Matrix, Effect } from '@babylonjs/core';

// ShaderMaterial stores effects per sub-mesh by default, but bind() calls bindOnlyWorldMatrix() without the
// sub-mesh's effect, so `world` lands on the material-level effect (Babylon 9.37). Use the effect that bind()
// just activated.
const origBindWorld = ShaderMaterial.prototype.bindOnlyWorldMatrix;
ShaderMaterial.prototype.bindOnlyWorldMatrix = function (this: ShaderMaterial & { _activeEffect?: Effect }, world: Matrix, effectOverride?: Effect | null) {
  return origBindWorld.call(this, world, effectOverride ?? this._activeEffect ?? null);
};

/** WebGPU + custom WGSL materials read unsigned-byte JOINTS_0 indices wrongly (Babylon 9.37); glTF exporters
 * write bytes for small skeletons. Re-upload them as floats once per mesh. */
export function fixSkinIndices(mesh: import('@babylonjs/core').Mesh): void {
  for (const kind of ['matricesIndices', 'matricesIndicesExtra']) {
    const vb = mesh.getVertexBuffer(kind);
    if (!vb || vb.type === 5126) continue;
    const data = mesh.getVerticesData(kind);
    if (data) mesh.setVerticesData(kind, Float32Array.from(data), false, 4);
  }
}
