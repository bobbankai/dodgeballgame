import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';

/**
 * A lighthouse beam: a long cone of soft light drawn over the finished page, brightest along its
 * axis and fading with distance, with a few pencilled streaks moving through it.
 */
export class Beam {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  intensity = 0;

  constructor(length = 80, radius = 7) {
    const g = new THREE.CylinderGeometry(radius, 0.35, length, 32, 1, true);
    g.translate(0, length / 2, 0);
    g.rotateX(Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
        uniform float uLen;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          vAlong = position.z / uLen;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uI; uniform float uTime; uniform vec3 uCol;
        varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
        ${NOISE}
        void main() {
          float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
          float fade = (1.0 - smoothstep(0.0, 1.0, vAlong)) * smoothstep(0.0, 0.03, vAlong);
          float streak = 0.75 + 0.25 * ibNoise(vec3(vW.xz * 0.35, uTime * 0.4));
          float a = core * fade * streak * uI * 0.55;
          gl_FragColor = vec4(uCol * a, a);
        }`,
      uniforms: { uI: { value: 0 }, uTime: G.uTime, uCol: { value: new THREE.Color().setHex(0xfff0c0, THREE.LinearSRGBColorSpace) }, uLen: { value: length } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  update() {
    this.mat.uniforms.uI.value = this.intensity;
    this.group.visible = this.intensity > 0.01;
  }
}
