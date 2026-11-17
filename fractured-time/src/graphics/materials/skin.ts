import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Real-time skin lighting.
 *
 * Light enters skin, scatters and leaves a few millimetres away: the terminator turns soft and red (red travels furthest,
 * blue least). Offline renderers (the Cycles review) use random-walk subsurface; this is the analytic pre-integrated family
 * (Penner 2011), evaluated per light:
 *  - each colour channel's N.L is wrapped by its own scatter width (red > green > blue), and only the light beyond plain
 *    Lambert is added, so lit areas stay physically based and the terminator gains the red bleed;
 *  - the widths grow with the surface's curvature, measured on screen (|dN| / |dP|): the nose, lips, ears and eyelids bleed
 *    more than the flat cheek, which is what the pre-integrated curvature lookup does;
 *  - the SSS material's own back-light translucency (ears and nostrils against a rim) stays.
 */
const T = TSL as any;
const { normalView, positionView, vec3, float, diffuseContribution, fwidth, length, smoothstep, max } = T;

// three does not export the SSS lighting model class; take it from the material that builds it
const SSSLightingModel = (THREE.MeshSSSNodeMaterial.prototype as any).setupLightingModel.call({}).constructor as typeof THREE.PhysicalLightingModel;

export interface SkinScatter {
  /** wrap width per channel at low curvature */
  wrap: [number, number, number];
  /** extra width at high curvature (radius ~1 cm) */
  curvatureWrap: [number, number, number];
  /** strength of the scattered term */
  amount: number;
}

export const DEFAULT_SCATTER: SkinScatter = { wrap: [0.5, 0.2, 0.11], curvatureWrap: [0.25, 0.1, 0.04], amount: 0.65 };

class SkinLightingModel extends (SSSLightingModel as any) {
  constructor(private scatter: SkinScatter, ...args: any[]) {
    super(...args);
  }

  direct(input: any, builder: any) {
    super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = input;
    const ndl = normalView.dot(lightDirection);
    // curvature 1/r (1/m) from screen derivatives; 0 on flat skin, ~1 at r = 1 cm
    const curv = smoothstep(10.0, 100.0, length(fwidth(normalView)).div(max(length(fwidth(positionView)), 1e-5)));
    const s = this.scatter;
    const w = vec3(...s.wrap).add(vec3(...s.curvatureWrap).mul(curv));
    const wrapped = ndl.add(w).div(w.add(1.0)).clamp(0.0, 1.0);
    const lam = ndl.clamp(0.0, 1.0);
    const extra = wrapped.mul(wrapped).sub(lam.mul(lam)).max(0.0);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(extra).mul(diffuseContribution).mul(float(s.amount / Math.PI)));
  }
}

export class SkinMaterial extends THREE.MeshSSSNodeMaterial {
  scatter: SkinScatter = { ...DEFAULT_SCATTER };

  setupLightingModel(): any {
    const self = this as any;
    return new SkinLightingModel(this.scatter, self.useClearcoat, self.useSheen, self.useIridescence, self.useAnisotropy, self.useTransmission,
      self.useDispersion, self.useSSS);
  }
}
