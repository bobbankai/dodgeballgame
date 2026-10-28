import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';

const VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
  uniform float uLen;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    vAlong = position.z / uLen;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** How strongly a point of the cone is lit: bright along the axis, fading out with distance. */
const BEAM = /* glsl */ `
  uniform float uI; uniform float uTime; uniform vec3 uCol;
  varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
  ${NOISE}
  float beam() {
    float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
    float fade = (1.0 - smoothstep(0.0, 1.0, vAlong)) * smoothstep(0.0, 0.03, vAlong);
    float streak = 0.75 + 0.25 * ibNoise(vec3(vW.xz * 0.35, uTime * 0.4));
    return core * fade * streak * uI;
  }`;

/**
 * A lighthouse beam: a long cone of soft light drawn over the finished page, brightest along its
 * axis and fading with distance, with a few pencilled streaks moving through it. On pale paper light
 * can't be added, so it is painted the way an illustrator would: a warm glaze laid over the page
 * (multiplied), with a glow on top where the page underneath is dark enough to show it.
 */
export class Beam {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  intensity = 0;

  constructor(length = 80, radius = 7) {
    const g = new THREE.CylinderGeometry(radius, 0.35, length, 32, 1, true);
    g.translate(0, length / 2, 0);
    g.rotateX(Math.PI / 2);
    const uniforms = { uI: { value: 0 }, uTime: G.uTime, uCol: { value: new THREE.Color().setHex(0xfff0c0, THREE.LinearSRGBColorSpace) }, uLen: { value: length },
      uGlaze: { value: new THREE.Color().setHex(0xffd27a, THREE.LinearSRGBColorSpace) } };
    // the glaze: page colour times a warm wash
    const glaze = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uGlaze;
        ${BEAM}
        void main() {
          gl_FragColor = vec4(mix(vec3(1.0), uGlaze, clamp(beam() * 0.5, 0.0, 0.42)), 1.0);
        }`,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        ${BEAM}
        void main() {
          float a = beam() * 0.55;
          gl_FragColor = vec4(uCol * a, a);
        }`,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // glaze first, glow over it
    for (const [m, order] of [[glaze, 0], [this.mat, 1]] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
    }
  }

  update() {
    this.mat.uniforms.uI.value = this.intensity;
    this.group.visible = this.intensity > 0.01;
  }
}
