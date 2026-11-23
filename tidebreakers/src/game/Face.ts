// Facial expressions for the procedural face shader (tbFace.wgsl): presets, blending, blinks, lip-sync.
import type { ShaderMaterial } from '@babylonjs/core';
import { v4 } from '../render/materials';

export interface FacePose {
  eyeOpen: number; browTilt: number; browRaise: number; mouthOpen: number; mouthCurve: number; mouthWidth: number;
  tears: number; blush: number; happy: number; squint: number; shout: number; pain: number; teeth: number;
  lookX: number; lookY: number; shine: number;
}

const N: FacePose = {
  eyeOpen: 1, browTilt: 0, browRaise: 0, mouthOpen: 0, mouthCurve: 0.1, mouthWidth: 1, tears: 0, blush: 0, happy: 0,
  squint: 0, shout: 0, pain: 0, teeth: 0.6, lookX: 0, lookY: 0, shine: 0,
};

function p(o: Partial<FacePose>): FacePose { return { ...N, ...o }; }

export const EXPRESSIONS: Record<string, FacePose> = {
  neutral: p({}),
  calm: p({ eyeOpen: 0.85, mouthCurve: 0.15 }),
  joy: p({ mouthOpen: 0.45, mouthCurve: 1, browRaise: 0.6, squint: 0.3, teeth: 0.7 }),
  grin: p({ mouthOpen: 0.25, mouthCurve: 1, mouthWidth: 1.35, teeth: 1, squint: 0.35, browTilt: 0.2 }),
  laugh: p({ happy: 1, mouthOpen: 0.75, mouthCurve: 1, browRaise: 0.7, teeth: 0.8 }),
  smile: p({ mouthCurve: 0.8, squint: 0.2, eyeOpen: 0.92 }),
  determined: p({ browTilt: 0.7, eyeOpen: 0.85, mouthCurve: -0.15, squint: 0.25 }),
  angry: p({ browTilt: 1, eyeOpen: 0.9, mouthOpen: 0.25, mouthCurve: -0.6, teeth: 1, squint: 0.3 }),
  shout: p({ browTilt: 1, eyeOpen: 1, mouthOpen: 1, shout: 1, mouthCurve: -0.3, teeth: 1 }),
  sad: p({ browTilt: -1, browRaise: 0.2, eyeOpen: 0.7, mouthCurve: -0.7, lookY: -0.4, shine: 0.6 }),
  cry: p({ browTilt: -1, browRaise: 0.3, eyeOpen: 0.55, mouthOpen: 0.35, mouthCurve: -0.9, tears: 1, shine: 1, squint: 0.3 }),
  sob: p({ browTilt: -1, browRaise: 0.4, eyeOpen: 0.15, mouthOpen: 0.7, mouthCurve: -1, tears: 1, shout: 0.3, pain: 0.6 }),
  shock: p({ eyeOpen: 1.1, browRaise: 1, mouthOpen: 0.6, mouthCurve: -0.2, shine: 0.2 }),
  worried: p({ browTilt: -0.7, browRaise: 0.3, mouthCurve: -0.35, eyeOpen: 0.95, lookX: 0.3 }),
  pain: p({ browTilt: -0.4, eyeOpen: 0.2, squint: 0.8, mouthOpen: 0.35, mouthCurve: -0.8, pain: 1, teeth: 1 }),
  smirk: p({ mouthCurve: 0.6, mouthWidth: 0.9, browTilt: 0.35, eyeOpen: 0.8 }),
  tired: p({ eyeOpen: 0.45, browTilt: -0.3, mouthCurve: -0.1 }),
  tender: p({ eyeOpen: 0.7, mouthCurve: 0.55, browTilt: -0.45, shine: 0.5, squint: 0.15 }),
  embarrassed: p({ blush: 1, mouthCurve: 0.3, browTilt: -0.5, lookX: -0.5, eyeOpen: 0.85 }),
  dead: p({ eyeOpen: 0.0, mouthOpen: 0.1, mouthCurve: -0.2 }),
  hit: p({ eyeOpen: 0.15, squint: 0.9, pain: 1, mouthOpen: 0.5, mouthCurve: -0.7, browTilt: -0.3, teeth: 1 }),
  effort: p({ browTilt: 0.9, eyeOpen: 0.7, squint: 0.5, mouthOpen: 0.3, mouthCurve: -0.5, teeth: 1, shout: 0.3 }),
};

export interface FaceStyle {
  eyeStyle: number; eyeSize: number; irisSize: number;
  irisTop: [number, number, number]; irisBottom: [number, number, number]; ink: [number, number, number]; lineWeight: number;
}

/** Drives one character's face: target expression with smooth blending, autonomous blinks, lip flaps. */
export class Face {
  current: FacePose = { ...N };
  target: FacePose = { ...N };
  autoBlink = true;
  talk = 0;           // 0..1 mouth activity from speech
  look = { x: 0, y: 0 };
  private blinkT = 2;
  private blink = 0;
  private speed = 8;
  private flap = 0;

  constructor(readonly mats: ShaderMaterial[], readonly style: FaceStyle) {
    for (const m of mats) this.applyStyle(m);
  }

  set(name: keyof typeof EXPRESSIONS | string, speed = 8): void {
    const e = EXPRESSIONS[name] ?? EXPRESSIONS.neutral;
    this.target = { ...e };
    this.speed = speed;
  }

  snap(name: string): void {
    this.set(name);
    this.current = { ...this.target };
  }

  private applyStyle(m: ShaderMaterial): void {
    const s = this.style;
    m.setVector4('irisA', v4(s.irisTop[0], s.irisTop[1], s.irisTop[2], 0.6));
    m.setVector4('irisB', v4(s.irisBottom[0], s.irisBottom[1], s.irisBottom[2], 0));
    m.setVector4('faceInk', v4(s.ink[0], s.ink[1], s.ink[2], s.lineWeight));
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-this.speed * dt);
    const c = this.current as unknown as Record<string, number>;
    const t = this.target as unknown as Record<string, number>;
    for (const key in t) c[key] += (t[key] - c[key]) * k;
    // blinks: quick close/open every 2-5 s (not while eyes are already shut)
    if (this.autoBlink) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2 + ((Math.sin(time * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3.2; }
    }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7);
    const blinkAmt = this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0;
    // lip flap from speech energy
    this.flap += dt * (9 + this.talk * 6);
    const talkOpen = this.talk > 0.01 ? this.talk * (0.35 + 0.35 * Math.abs(Math.sin(this.flap * 1.7) * Math.sin(this.flap * 0.9 + 1))) : 0;
    const open = Math.max(0, c.eyeOpen * (1 - blinkAmt));
    const lx = c.lookX + this.look.x, ly = c.lookY + this.look.y;
    for (const m of this.mats) {
      m.setVector4('faceA', v4(open, open, lx, ly));
      m.setVector4('faceB', v4(c.browTilt, c.browRaise, Math.min(1.2, c.mouthOpen + talkOpen), c.mouthCurve));
      m.setVector4('faceC', v4(c.mouthWidth, c.tears, c.blush, c.happy));
      m.setVector4('faceD', v4(this.style.eyeStyle, this.style.eyeSize, this.style.irisSize, c.teeth));
      m.setVector4('faceMisc', v4(c.shout, c.shine, c.squint, c.pain));
    }
  }
}
