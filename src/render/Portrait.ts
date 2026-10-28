import * as THREE from 'three';

type Pt = [number, number];
type Step = (g: CanvasRenderingContext2D) => void;

const W = 1024;
const H = 752;

/** Deterministic randomness, so the picture is the same every time it is drawn. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * The last page: Mum and Ada side by side, Pip at their feet, the Great Tree and the lighthouse on
 * the horizon. Painted onto a canvas a step at a time (pencil, then washes, then the details), so
 * the game can show it being drawn; the Smudge's grey becomes its first layer, the shading.
 */
export class Portrait {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private steps: Step[] = [];
  private done = 0;
  /** How many of the steps are the shading (drawn with the Smudge). */
  readonly shadeSteps: number;

  /** `caption` and `signature` are what's pencilled under the picture (Mum signs hers differently). */
  constructor(private caption = 'Mum & me', private signature = '— Ada') {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.paper();
    this.shadeSteps = this.shading();
    this.compose();
    this.texture.needsUpdate = true;
  }

  /** Paint everything up to `progress` (0..1) that isn't painted yet. */
  paint(progress: number) {
    const n = Math.min(this.steps.length, Math.floor(progress * this.steps.length + 1e-6));
    if (n <= this.done) return;
    for (let i = this.done; i < n; i++) {
      this.g.save();
      this.steps[i](this.g);
      this.g.restore();
    }
    this.done = n;
    this.texture.needsUpdate = true;
  }

  /** The fraction of the steps that are shading. */
  get shadeFraction() {
    return this.shadeSteps / this.steps.length;
  }

  // --- drawing tools ---------------------------------------------------------------------------

  private paper() {
    const g = this.g;
    g.fillStyle = '#f7f1e3';
    g.fillRect(0, 0, W, H);
    const r = rng(7);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(120,100,70,${0.02 + r() * 0.035})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
    }
  }

  /** A pencil line: a few light, slightly wandering passes along a smooth curve. */
  private line(pts: Pt[], o: { w?: number; col?: string; passes?: number; jit?: number; seed?: number } = {}): Step {
    return (g) => {
      const r = rng(o.seed ?? Math.round(pts[0][0] * 7 + pts[0][1] * 13 + 1));
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const passes = o.passes ?? 3;
      for (let p = 0; p < passes; p++) {
        const j = o.jit ?? 1.6;
        const q = pts.map(([x, y]) => [x + (r() - 0.5) * j, y + (r() - 0.5) * j] as Pt);
        g.strokeStyle = o.col ?? 'rgba(52,44,48,0.55)';
        g.lineWidth = (o.w ?? 2.2) * (0.7 + r() * 0.5);
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < q.length - 1; i++) {
          const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2;
          g.quadraticCurveTo(q[i][0], q[i][1], mx, my);
        }
        g.lineTo(q[q.length - 1][0], q[q.length - 1][1]);
        g.stroke();
      }
    };
  }

  /** A watercolour wash: a soft fill a little outside the lines, with a darker drying edge. */
  private wash(shape: (g: CanvasRenderingContext2D) => void, col: string, a = 0.75, edge = 0.3): Step {
    return (g) => {
      g.globalAlpha = a;
      g.filter = 'blur(1.2px)';
      g.fillStyle = col;
      g.beginPath();
      shape(g);
      g.fill();
      g.filter = 'none';
      g.globalAlpha = edge;
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.stroke();
      // pigment pooling in the middle of the wash
      g.globalAlpha = 0.12;
      g.globalCompositeOperation = 'multiply';
      g.fill();
      g.globalCompositeOperation = 'source-over';
    };
  }

  private poly(pts: Pt[], close = true) {
    return (g: CanvasRenderingContext2D) => {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i];
        const [px, py] = pts[i - 1];
        g.quadraticCurveTo(px + (x - px) * 0.5 + (y - py) * 0.04, py + (y - py) * 0.5 - (x - px) * 0.04, x, y);
      }
      if (close) g.closePath();
    };
  }

  private ellipse(x: number, y: number, rx: number, ry: number, rot = 0) {
    return (g: CanvasRenderingContext2D) => {
      // start a new sub-path, so several ellipses in one wash don't get joined up
      g.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
      g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    };
  }

  /** Cross-hatched graphite in an area: the Smudge, turned into shading. */
  private hatch(shape: (g: CanvasRenderingContext2D) => void, x0: number, y0: number, x1: number, y1: number, dens = 9, a = 0.22): Step {
    return (g) => {
      const r = rng(Math.round(x0 * 3 + y0 * 5));
      g.beginPath();
      shape(g);
      g.clip();
      g.strokeStyle = `rgba(60,56,62,${a})`;
      g.lineWidth = 1.3;
      for (let x = x0 - (y1 - y0); x < x1; x += dens) {
        g.beginPath();
        g.moveTo(x + r() * 3, y1);
        g.lineTo(x + (y1 - y0) * 0.9 + r() * 3, y0);
        g.stroke();
      }
      g.filter = 'blur(3px)';
      g.fillStyle = `rgba(80,76,84,${a * 0.6})`;
      g.beginPath();
      shape(g);
      g.fill();
      g.filter = 'none';
    };
  }

  // --- the picture -----------------------------------------------------------------------------

  /** Shadows first: under the figures, along the hill, the shaded sides of coat and hair. */
  private shading() {
    const s = this.steps;
    s.push(this.hatch(this.ellipse(470, 648, 230, 26), 230, 615, 720, 680, 8, 0.28));
    s.push(this.hatch(this.poly([[0, 610], [300, 585], [620, 600], [1024, 585], [1024, 752], [0, 752]]), 0, 580, 1024, 752, 12, 0.12));
    s.push(this.hatch(this.poly([[345, 310], [372, 300], [362, 450], [338, 565], [318, 562]]), 310, 290, 380, 570, 7, 0.24));
    s.push(this.hatch(this.poly([[553, 440], [575, 432], [568, 520], [556, 566], [540, 560]]), 535, 430, 580, 570, 7, 0.24));
    s.push(this.hatch(this.ellipse(378, 250, 24, 62, 0.12), 350, 185, 410, 320, 6, 0.2));
    return s.length;
  }

  private compose() {
    const s = this.steps;
    const L = (pts: Pt[], o = {}) => s.push(this.line(pts, o));
    // horizon and hill, the Great Tree on the left, the lighthouse far off on the right
    L([[0, 600], [180, 584], [360, 592], [560, 600], [760, 588], [1024, 596]], { w: 2 });
    L([[70, 590], [76, 520], [72, 470]], { w: 3 });
    s.push(this.line([[40, 470], [30, 430], [60, 395], [100, 400], [120, 440], [104, 476], [60, 482], [40, 470]], { w: 2 }));
    L([[915, 590], [920, 520], [936, 520], [941, 590]], { w: 1.8 });
    L([[912, 520], [944, 520]], { w: 1.6 });
    // Mum: her dress and painter's apron, arms, head, long hair and the braid over her shoulder
    L([[372, 300], [350, 420], [336, 566], [504, 566], [490, 420], [468, 300]], { w: 2.4 });
    L([[400, 318], [440, 318], [440, 398], [456, 398], [468, 548], [372, 548], [384, 398], [400, 398], [400, 318]], { w: 2 });
    L([[400, 318], [408, 292]], { w: 1.6 });
    L([[440, 318], [432, 292]], { w: 1.6 });
    s.push(this.line([[412, 446], [432, 440], [450, 446], [448, 468], [414, 468], [412, 446]], { w: 1.6 }));
    L([[370, 306], [348, 380], [340, 452]], { w: 2.2 });
    L([[470, 306], [500, 380], [522, 466]], { w: 2.2 });
    L([[404, 566], [400, 630]], { w: 2.4 });
    L([[440, 566], [446, 630]], { w: 2.4 });
    s.push(this.line([[372, 236], [376, 200], [400, 184], [432, 186], [460, 206], [466, 240], [458, 270], [438, 284], [404, 284], [382, 270], [372, 236]], { w: 2.2 }));
    s.push(this.line([[366, 240], [370, 198], [400, 178], [438, 180], [468, 204], [474, 244], [482, 286], [486, 322], [478, 342]], { w: 2.6 }));
    L([[374, 250], [364, 276], [373, 300], [362, 324], [371, 348], [361, 372], [367, 394]], { w: 2.2 });
    // Ada: raincoat, scarf, hood, boots, arms; her hand in Mum's
    L([[574, 432], [556, 500], [546, 566], [656, 566], [646, 500], [630, 432]], { w: 2.4 });
    L([[574, 432], [600, 446], [630, 432]], { w: 2.4 });
    L([[572, 440], [546, 470], [524, 470]], { w: 2.2 });
    L([[632, 440], [654, 490], [660, 524]], { w: 2.2 });
    L([[580, 566], [578, 622]], { w: 2.4 });
    L([[622, 566], [626, 622]], { w: 2.4 });
    s.push(this.line([[566, 388], [570, 360], [592, 346], [616, 348], [634, 366], [638, 392], [628, 414], [604, 424], [582, 418], [568, 404], [566, 388]], { w: 2.2 }));
    s.push(this.line([[562, 404], [562, 366], [584, 342], [618, 342], [642, 370], [642, 406]], { w: 2.6 }));
    // Pip sitting at Ada's feet
    s.push(this.line([[680, 628], [686, 596], [700, 584], [714, 600], [716, 628], [680, 628]], { w: 2 }));
    s.push(this.line([[690, 588], [692, 566], [702, 578], [712, 566], [714, 588]], { w: 2 }));
    L([[714, 622], [742, 612], [752, 594]], { w: 2.2 });
    // --- colour: sky, sun, hill
    s.push((g) => {
      // the sky: a wash laid wet at the top and let fade towards the hill
      const grad = g.createLinearGradient(0, 0, 0, 590);
      grad.addColorStop(0, 'rgba(140,184,222,0.55)');
      grad.addColorStop(0.55, 'rgba(170,204,230,0.32)');
      grad.addColorStop(1, 'rgba(200,220,236,0.0)');
      g.filter = 'blur(2px)';
      g.fillStyle = grad;
      g.fillRect(-10, -10, W + 20, 610);
      g.filter = 'none';
    });
    s.push(this.wash(this.ellipse(842, 128, 58, 58), '#f2c14e', 0.85));
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      L([[842 + Math.cos(a) * 72, 128 + Math.sin(a) * 72], [842 + Math.cos(a) * 98, 128 + Math.sin(a) * 98]], { w: 2.6, col: 'rgba(214,150,40,0.7)' });
    }
    s.push(this.wash(this.poly([[0, 600], [180, 584], [360, 592], [560, 600], [760, 588], [1024, 596], [1024, 752], [0, 752]]), '#97c06e', 0.7));
    s.push(this.wash(this.ellipse(76, 438, 46, 42), '#5f9a4a', 0.85));
    s.push(this.wash((g) => g.rect(915, 520, 26, 70), '#f1ebe0', 0.9));
    s.push(this.wash((g) => { g.rect(916, 538, 24, 12); g.rect(917, 562, 23, 12); }, '#c0473a', 0.85, 0.1));
    // Mum in colour: indigo dress, cream apron splashed with paint, copper hair
    s.push(this.wash(this.poly([[372, 300], [350, 420], [336, 566], [504, 566], [490, 420], [468, 300]]), '#3e4f8a', 0.85));
    s.push(this.wash((g) => { this.poly([[370, 306], [348, 380], [340, 452], [352, 452], [362, 380], [380, 312]])(g); this.poly([[470, 306], [500, 380], [522, 466], [510, 466], [488, 380], [460, 312]])(g); }, '#3e4f8a', 0.85, 0.2));
    s.push(this.wash(this.poly([[400, 318], [440, 318], [440, 398], [456, 398], [468, 548], [372, 548], [384, 398], [400, 398]]), '#efe6d0', 0.92, 0.25));
    s.push(this.wash((g) => { this.ellipse(410, 430, 8, 6)(g); this.ellipse(452, 522, 6, 5)(g); this.ellipse(392, 512, 5, 4)(g); }, '#6e9e4f', 0.85, 0.1));
    s.push(this.wash((g) => { this.ellipse(448, 492, 7, 5)(g); this.ellipse(394, 470, 5, 4)(g); this.ellipse(428, 350, 4, 4)(g); }, '#3d6b8c', 0.85, 0.1));
    s.push(this.wash((g) => { this.ellipse(404, 532, 7, 6)(g); this.ellipse(434, 410, 5, 4)(g); this.ellipse(418, 374, 3, 3)(g); }, '#e2b33c', 0.9, 0.1));
    s.push(this.wash(this.poly([[372, 236], [376, 200], [400, 184], [432, 186], [460, 206], [466, 240], [458, 270], [438, 284], [404, 284], [382, 270]]), '#f0c9a3', 0.85, 0.15));
    s.push(this.wash((g) => {
      this.poly([[364, 244], [368, 196], [404, 174], [442, 178], [472, 204], [476, 244], [484, 286], [488, 324], [478, 344], [466, 330], [468, 292], [464, 252], [460, 212], [440, 196], [404, 194], [382, 212], [376, 250]])(g);
      for (let k = 0; k < 11; k++) this.ellipse(369 + (k % 2 ? -4 : 4), 256 + k * 13, 9, 8)(g);
    }, '#a8552e', 0.9));
    s.push(this.wash(this.ellipse(366, 400, 7, 5), '#3f7f7a', 0.9, 0.1));
    s.push(this.wash((g) => { g.rect(396, 566, 12, 62); g.rect(438, 566, 12, 62); }, '#3b3542', 0.8, 0.1));
    s.push(this.wash((g) => { this.ellipse(398, 632, 16, 8)(g); this.ellipse(450, 632, 16, 8)(g); }, '#6a4430', 0.9));
    s.push(this.wash((g) => { this.ellipse(340, 456, 9, 11)(g); this.ellipse(523, 470, 9, 10)(g); }, '#f0c9a3', 0.9, 0.15));
    // Ada in colour
    s.push(this.wash(this.poly([[574, 432], [556, 500], [546, 566], [656, 566], [646, 500], [630, 432]]), '#e9b840', 0.88));
    s.push(this.wash((g) => { this.poly([[572, 440], [546, 470], [524, 470], [526, 480], [550, 482], [578, 456]])(g); this.poly([[632, 440], [654, 490], [660, 524], [650, 526], [642, 494], [624, 452]])(g); }, '#e9b840', 0.88, 0.2));
    s.push(this.wash(this.poly([[570, 426], [600, 440], [634, 426], [632, 440], [612, 450], [616, 492], [604, 494], [600, 452], [570, 440]]), '#c8483a', 0.9));
    s.push(this.wash(this.poly([[566, 388], [570, 360], [592, 346], [616, 348], [634, 366], [638, 392], [628, 414], [604, 424], [582, 418], [568, 404]]), '#f2cda8', 0.85, 0.15));
    s.push(this.wash(this.poly([[560, 406], [560, 366], [584, 340], [618, 340], [644, 370], [644, 408], [636, 404], [632, 372], [616, 360], [592, 362], [570, 380], [568, 406]]), '#4a3328', 0.92));
    s.push(this.wash((g) => { g.rect(574, 566, 10, 52); g.rect(620, 566, 10, 52); }, '#2e3445', 0.8, 0.1));
    s.push(this.wash((g) => { this.ellipse(578, 624, 14, 9)(g); this.ellipse(628, 624, 14, 9)(g); }, '#2f6f73', 0.9));
    s.push(this.wash(this.ellipse(662, 528, 8, 10), '#f2cda8', 0.9, 0.15));
    // Pip in colour
    s.push(this.wash(this.poly([[680, 628], [686, 596], [700, 584], [714, 600], [716, 628]]), '#e0783a', 0.9));
    s.push(this.wash(this.poly([[690, 588], [692, 566], [702, 578], [712, 566], [714, 588], [702, 596]]), '#e0783a', 0.9));
    s.push(this.wash(this.poly([[714, 622], [742, 612], [752, 594], [758, 604], [744, 622]]), '#e0783a', 0.9));
    s.push(this.wash(this.ellipse(753, 598, 6, 6), '#fbf6ea', 0.95, 0.1));
    // faces: eyes, lashes, freckles, smiles, rosy cheeks
    const dot = (x: number, y: number, r = 3.4, col = '#2a2226'): Step => (g) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    s.push(dot(406, 238), dot(434, 238), dot(592, 390), dot(614, 390), dot(698, 600, 2.2), dot(708, 600, 2.2));
    L([[399, 235], [406, 232.5], [413, 235], [416, 233]], { w: 1.2, passes: 2 });
    L([[427, 235], [434, 232.5], [441, 235], [444, 233]], { w: 1.2, passes: 2 });
    L([[398, 224], [406, 220.5], [414, 222.5]], { w: 1.4, passes: 2, col: 'rgba(150,72,42,0.75)' });
    L([[426, 222.5], [434, 220.5], [442, 224]], { w: 1.4, passes: 2, col: 'rgba(150,72,42,0.75)' });
    s.push(dot(399, 251, 1.4, '#b7704e'), dot(404, 255, 1.2, '#b7704e'), dot(410, 252, 1.3, '#b7704e'), dot(431, 252, 1.3, '#b7704e'),
      dot(437, 255, 1.2, '#b7704e'), dot(442, 251, 1.4, '#b7704e'));
    L([[408, 262], [420, 268], [432, 262]], { w: 1.8, col: 'rgba(150,60,50,0.8)' });
    L([[594, 406], [603, 411], [612, 406]], { w: 1.8, col: 'rgba(150,60,50,0.8)' });
    s.push(this.wash((g) => { this.ellipse(398, 254, 8, 5)(g); this.ellipse(444, 254, 8, 5)(g); this.ellipse(584, 401, 7, 4)(g); this.ellipse(622, 401, 7, 4)(g); }, '#e58a7a', 0.35, 0));
    // brushes in her apron pocket, the apron ties at her waist; Ada's pencil behind her ear
    L([[424, 446], [420, 418]], { w: 2.6, col: 'rgba(199,154,98,0.95)', passes: 2 });
    L([[432, 446], [436, 414]], { w: 2.6, col: 'rgba(199,154,98,0.95)', passes: 2 });
    s.push(dot(420, 416, 2.6, '#3d6b8c'), dot(436, 412, 2.6, '#e2b33c'));
    L([[352, 400], [490, 400]], { w: 4, col: 'rgba(239,230,208,0.95)', passes: 2 });
    L([[640, 372], [652, 344]], { w: 3, col: 'rgba(240,196,49,0.95)', passes: 2 });
    // the hands, held
    s.push(this.wash(this.ellipse(523, 472, 11, 10), '#f0c9a3', 0.95, 0.25));
    // a heart drawn in the sky between them, the way Ada always signed things
    s.push(this.line([[500, 140], [490, 124], [500, 114], [510, 124], [520, 114], [530, 124], [520, 140], [510, 152], [500, 140]], { w: 2.4, col: 'rgba(200,72,58,0.85)' }));
    // caption, in pencil
    s.push((g) => {
      g.font = '54px Caveat, cursive';
      g.fillStyle = 'rgba(48,42,46,0.85)';
      g.textAlign = 'center';
      g.fillText(this.caption, W / 2, 712);
      g.font = '28px Caveat, cursive';
      g.textAlign = 'right';
      g.fillText(this.signature, W - 40, H - 22);
    });
  }
}
