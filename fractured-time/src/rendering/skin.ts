import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Real-time skin lighting. Light enters skin, scatters, and leaves a few millimetres away: the shadow terminator turns soft and red
 * (red travels furthest, blue least), which is most of what makes skin look like skin rather than painted plastic. Offline renderers
 * (the Cycles review) do this with random-walk subsurface; games approximate it. This uses per-channel wrapped diffuse on top of the
 * standard lighting (the "pre-integrated skin" family, analytic form): each colour channel's N.L is wrapped by its own scatter width,
 * and only the extra light beyond plain Lambert is added, so lit areas stay physically based and the terminator gains the red bleed.
 * It extends the SSS material's own lighting model, so its back-light translucency (ears, nostrils) still works.
 */
const T = TSL as any;
const { normalView, vec3, float, diffuseContribution } = T;

// three does not export the SSS lighting model class; take it from the material that builds it
const SSSLightingModel = (THREE.MeshSSSNodeMaterial.prototype as any).setupLightingModel.call({}).constructor as typeof THREE.PhysicalLightingModel;

export interface SkinScatter {
  /** wrap width per channel (how far past the terminator each colour reaches); red > green > blue */
  wrap: [number, number, number];
  /** strength of the scattered term */
  amount: number;
}

class SkinLightingModel extends (SSSLightingModel as any) {
  constructor(private scatter: SkinScatter, ...args: any[]) {
    super(...args);
  }

  direct(input: any, builder: any) {
    super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = input;
    const ndl = normalView.dot(lightDirection);
    const w = vec3(...this.scatter.wrap);
    const wrapped = ndl.add(w).div(w.add(1.0)).clamp(0.0, 1.0);
    const extra = wrapped.mul(wrapped).sub(ndl.clamp(0.0, 1.0).mul(ndl.clamp(0.0, 1.0))).max(0.0); // squared wrap: soft falloff
    reflectedLight.directDiffuse.addAssign(lightColor.mul(extra).mul(diffuseContribution).mul(float(this.scatter.amount / Math.PI)));
  }
}

export class SkinNodeMaterial extends THREE.MeshSSSNodeMaterial {
  scatter: SkinScatter = { wrap: [0.5, 0.2, 0.11], amount: 0.65 };

  setupLightingModel(): any {
    const self = this as any;
    return new SkinLightingModel(this.scatter, self.useClearcoat, self.useSheen, self.useIridescence, self.useAnisotropy, self.useTransmission,
      self.useDispersion, self.useSSS);
  }
}
