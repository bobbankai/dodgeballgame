"""The Tidebreakers cast (besides Kai, who lives in chars.py). Each function returns a pipeline Spec."""
import math
import numpy as np
from tb import skeleton, body as bodymod, garment as G, pipeline as P, polychar as pc, wardrobe as W
from tb.wardrobe import Ctx, hexc, v, chain, shade_z, band_paint
from tb.sdf import Offset, Intersect, Union, Plane, Ellipsoid, Sphere

norm = G.norm


def skin_paint(bd, blush=0.25):
    fa = bd.face_anchor
    u = fa['u']
    cheeks = [fa['eye_L'] + v(0.006, 0.01, -0.032) * u, fa['eye_R'] + v(-0.006, 0.01, -0.032) * u]
    warm = hexc('#e8806e')

    def paint(V, N, col):
        m = np.zeros(len(V))
        for p in cheeks:
            m = np.maximum(m, np.clip(1 - np.linalg.norm(V - p, axis=1) / (0.026 * u), 0, 1) ** 1.5 * blush)
        return col * (1 - m[:, None]) + warm * m[:, None]
    return paint


def spec(name, sk, bd, skin, garments, parts, ref):
    flat_g, flat_p = [], []
    for g in garments:
        (flat_g.extend if isinstance(g, list) else flat_g.append)(g)
    for p in parts:
        (flat_p.extend if isinstance(p, list) else flat_p.append)(p)
    # parts returned as Garment from helpers (e.g. scarf()) go to garments
    gs = [x for x in flat_g + flat_p if isinstance(x, P.Garment)]
    ps = [x for x in flat_g + flat_p if isinstance(x, P.Part)]
    return P.Spec(name, sk, bd, hexc(skin), gs, ps, ref, skin_paint=skin_paint(bd), subdiv=1)


def spiky_short(c, color, dark, light):
    cl = W.fringe(c, color, n=5, length=0.09, spread=36, droop=0.3, curl=0.35)
    for th, ph, L in ((-40, 72, 0.1), (0, 78, 0.11), (40, 72, 0.1), (150, 40, 0.1), (180, 45, 0.11), (210, 40, 0.1)):
        a = math.radians(th)
        cl.append((th, ph, L, 0.034, v(math.sin(a) * 0.6, 0.7, 0.4 if abs(th) < 90 else -0.4), dict(curl=0.2, lift=0.012)))
    for sx in (1, -1):
        cl.append((95 * sx, 35, 0.08, 0.03, v(sx, 0.3, -0.4), dict(curl=0.2, droop=0.2, lift=0.012)))
    # spikes stand free of the head (not combed down over it)
    cl = [(*s[:5], {**(s[5] if len(s) > 5 else {}), 'comb': False}) for s in cl]
    return [W.hair_cap(c, color, front=0.2, sides=0.12, back=0.06, dark=dark, light=light, thick=0.012), W.clumps(c, cl, color, dark, light)]


# ============================================================================================ Armada

def _armada_soldier(name, coat_color, trouser_color, hat, extra_parts=(), height=1.78, build=0.55, rifle=False, ref_summary=''):
    sk = skeleton.Skeleton(height=height, head=0.235, shoulder=0.19)
    bd = bodymod.Body(sk, face='man', build=build, jaw=1.08, nose=0.85)
    c = Ctx(sk, bd)
    g = [W.shirt(c, coat_color, sleeves=1.9, neck='v', offset=0.01, hem=c.waist - 0.11, name='tunic',
                 paint=chain(band_paint('#23305c', c.waist - 0.1, 0.012), shade_z(c.waist - 0.11, c.neck_base, 0.12))),
         W.shirt(c, '#f2efe8', sleeves=0, neck='round', offset=0.005, name='undershirt', covers=True),
         W.trousers(c, trouser_color, cuff=c.knee_z - 0.08, loose=0.012, flare=0.004),
         W.boots(c, '#2a1e1a', top=c.knee_z - 0.04)]
    g += W.belt(c, '#3a2a1e', z=c.waist - 0.02, buckle='#d8a93c')
    parts = []
    if hat == 'cap':
        parts += W.hat_cap(c, '#f4f2ec', band='#23305c')
    elif hat == 'shako':
        top = c.fa['cranium'] + v(0, 0, 0.05) * c.u
        parts.append(P.Part('shako', *W.cylinder(top, 0.108 * c.u, 0.2 * c.u, n=24), hexc('#23305c'), weights=('rigid', 'head'),
                            paint=band_paint('#d8a93c', top[2] + 0.19 * c.u, 0.01)))
    parts += spiky_short(c, '#4a3526', '#2e2019', '#6b4d36')[1:] if hat else spiky_short(c, '#4a3526', '#2e2019', '#6b4d36')
    parts += list(extra_parts)
    ref = dict(title=name, summary=ref_summary, palette={'tunic': coat_color, 'trousers': trouser_color, 'trim': '#d8a93c', 'boots': '#2a1e1a'},
               shapes=['Upright rectangles: the Armada is order and uniformity', 'White and navy with gold trim, readable at a distance in a crowd'],
               motion=['Drilled, upright stance; attacks are clean, telegraphed and readable'])
    return spec(name.lower().split()[-1], sk, bd, '#e3b08c', g, parts, ref)


def marine():
    return _armada_soldier('Armada Marine', '#f4f2ec', '#23305c', 'cap',
                           ref_summary='The Armada\'s rank and file: white tunics, navy trousers, peaked caps and cutlasses.')


def rifleman():
    s = _armada_soldier('Armada Rifleman', '#2c4a86', '#eeeae0', 'shako',
                        ref_summary='Ranged marines in blue coats and tall shakos; they hang back and fire telegraphed shots.')
    s.name = 'rifleman'
    return s


def elite():
    sk = skeleton.Skeleton(height=1.84, head=0.235, shoulder=0.2)
    bd = bodymod.Body(sk, face='man', build=0.65, jaw=1.12)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#fbf6e6', sleeves=1.9, neck='round', offset=0.012, hem=c.waist - 0.06, name='coat',
                 paint=chain(band_paint('#d8a93c', c.waist - 0.055, 0.01))),
         W.trousers(c, '#f4efe4', cuff=c.knee_z - 0.06, loose=0.01, flare=0.003),
         W.boots(c, '#1f1a1c', top=c.knee_z - 0.02)]
    g += W.belt(c, '#d8a93c', z=c.waist - 0.02, buckle='#fff0b0')
    parts = [W.skirt_loft(c, '#fbf6e6', c.waist - 0.04, c.knee_z + 0.02, offset=0.03, flare=0.1, front_open=0.25, name='coattail',
                          paint=band_paint('#d8a93c', c.knee_z + 0.03, 0.012))]
    parts += W.helmet(c, '#e8c25a', crest='#c0262e')
    parts += W.epaulettes(c)
    ref = dict(title='Gilded Elite', summary="Vale's personal guard: gold helmets with red crests, long white coats, sabres. They parry.",
               palette={'coat': '#fbf6e6', 'gold': '#e8c25a', 'crest': '#c0262e'}, shapes=['Tall, gold-capped verticals'], motion=['Fencing footwork, quick reactive guards'])
    return spec('elite', sk, bd, '#e3b08c', g, parts, ref)


def brute():
    sk = skeleton.Skeleton(height=2.08, head=0.25, shoulder=0.26, hip=0.11, leg=1.0, knee=0.53, upperarm=0.34, forearm=0.31, hand=0.21)
    bd = bodymod.Body(sk, face='brute', build=1.0, fat=0.35, chest=1.2, limb=1.25, hand=1.25)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#23305c', sleeves=1.2, neck='round', offset=0.01, name='gambeson'),
         W.trousers(c, '#23305c', cuff=c.knee_z - 0.05, loose=0.014, flare=0.005),
         W.boots(c, '#2a1e1a', top=c.knee_z)]
    # steel cuirass over the gambeson
    # a smooth plate: shaped on the trunk without the chest muscles (no moulded pecs)
    # (it also clears the gambeson over the chest by a few cm, or the cloth pokes through the plate)
    plate = Union([Offset(bd.region(['torso', 'spine', 'hips'], 0.05), 0.045), Offset(c.torso, 0.034)], 0.05)
    g.append(P.Garment('cuirass', plate, Intersect([G.above(c.waist - 0.05), G.below(c.neck_base - 0.02),
                                                                  pc.complement(Union([Sphere(c.j[f'shoulder.{s}'] + v(sx * 0.04, 0, -0.04), 0.1) for s, sx in (('L', 1), ('R', -1))]))]),
                       hexc('#aab4c2'), cls='metal', thickness=0.012, covers=False,
                       paint=band_paint('#d8a93c', c.waist - 0.04, 0.012)))
    parts = W.pauldrons(c, '#aab4c2')
    parts += W.helmet(c, '#8c96a6')
    W.beard  # noqa (brutes are clean-shaven under the helmet)
    ref = dict(title='Armada Bulwark', summary='Huge shield-bearers in steel cuirasses. Their shield bash and overhead smash cannot be blocked.',
               palette={'steel': '#aab4c2', 'navy': '#23305c'}, shapes=['A wall: wide shoulders, small head, heavy boots'], motion=['Slow, planted, every hit lands like a door'])
    return spec('brute', sk, bd, '#d9a27e', g, parts, ref)


def thug():
    sk = skeleton.Skeleton(height=1.74, head=0.24, shoulder=0.195)
    bd = bodymod.Body(sk, face='man', build=0.7, fat=0.2, nose=1.2)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#8c8478', sleeves=0.9, neck='v', offset=0.008, name='shirt', paint=shade_z(c.waist, c.neck_base, 0.25)),
         W.shirt(c, '#5a3a24', sleeves=0, neck='v', offset=0.016, hem=c.waist + 0.0, name='vest', covers=False),
         W.trousers(c, '#4a4338', cuff=c.ankle_z + 0.1, loose=0.016, flare=0.01),
         W.boots(c, '#2a221c', top=c.ankle_z + 0.12)]
    parts = W.scarf(c, '#9a3a2a', tails=False)
    parts += spiky_short(c, '#3a2a22', '#22180f', '#5a4434')
    ref = dict(title='Ashport Thug', summary="Baron Gorrick's enforcers: soot-stained shirts, leather vests, red neckerchiefs, fists and clubs.",
               palette={'shirt': '#8c8478', 'vest': '#5a3a24', 'kerchief': '#9a3a2a'}, shapes=['Hunched, heavy shoulders, sooty desaturated colours'], motion=['Brawling, swinging haymakers'])
    return spec('thug', sk, bd, '#c9906e', g, parts, ref)


def wrecker():
    sk = skeleton.Skeleton(height=1.76, head=0.24, shoulder=0.19)
    bd = bodymod.Body(sk, face='man', build=0.6, nose=1.1)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#2f4a3e', sleeves=1.9, neck='v', offset=0.012, hem=c.waist - 0.04, name='coat', paint=shade_z(c.waist, c.neck_base, 0.2)),
         W.trousers(c, '#3a3530', cuff=c.ankle_z + 0.12, loose=0.014),
         W.boots(c, '#1e1a16', top=c.knee_z - 0.06)]
    g += W.belt(c, '#2a1e16', z=c.waist - 0.02)
    parts = W.scarf(c, '#c8b48a', tails=True)
    parts += spiky_short(c, '#1e1a18', '#0f0c0b', '#3a302a')
    ref = dict(title='Wrecker', summary='Storm scavengers of the Weeping Shoals: oilskin coats, hooks and knives.', palette={'coat': '#2f4a3e', 'scarf': '#c8b48a'},
               shapes=['Wet, dark, ragged'], motion=['Quick, low, opportunistic'])
    return spec('wrecker', sk, bd, '#c79a7a', g, parts, ref)


# ============================================================================================ crew & family

def ines():
    sk = skeleton.Skeleton(height=1.52, head=0.23, shoulder=0.165, hip=0.085, leg=0.74, knee=0.4, upperarm=0.25, forearm=0.23, hand=0.16)
    bd = bodymod.Body(sk, face='old', build=0.2, fat=0.15, female=1, bust=0.7, nose=1.2)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#2a3446', sleeves=1.9, neck='round', offset=0.016, hem=c.waist - 0.04, name='coat', paint=shade_z(c.waist, c.neck_base, 0.15)),
         W.trousers(c, '#3a3226', cuff=c.ankle_z + 0.08, loose=0.02, flare=0.01),
         W.boots(c, '#2a1e1a', top=c.ankle_z + 0.16)]
    parts = [W.skirt_loft(c, '#2a3446', c.waist - 0.02, c.knee_z - 0.08, offset=0.035, flare=0.1, front_open=0.18, name='coatskirt',
                          paint=band_paint('#b89448', c.knee_z - 0.07, 0.012))]
    parts.append(W.buttons(c, '#c9a24a', c.waist + 0.02, c.neck_base - 0.08, n=4, y=-0.12, x=0.06))
    parts += W.scarf(c, '#8e2c2c', tails=True)
    parts += W.hat_tricorn(c, '#1c1f2a')
    # grey hair: bun at the back under the hat
    cap = W.hair_cap(c, '#b8b4b0', front=0.18, sides=0.11, back=0.06, dark='#8f8b88', light='#e4e0dc', thick=0.012, strands=0)
    bun = P.Part('bun', *pc.quad_sphere(c.fa['cranium'] + v(0, 0.12, -0.03) * c.u, (0.045 * c.u, 0.04 * c.u, 0.045 * c.u), res=3), hexc('#c8c4c0'), cls='hair',
                 weights=('rigid', 'head'))
    parts += [cap, bun]
    ref = dict(title='Grandma Ines', summary='74. Raised Kai on Gull\'s Rest. Navigator of the hanged crew of the Merry Albatross; she stayed so someone would remember them. '
               'Small, stooped, sharp-eyed; a long navy coat with brass buttons, red scarf and an old tricorn.',
               palette={'coat': '#2a3446', 'scarf': '#8e2c2c', 'hat': '#1c1f2a', 'hair': '#b8b4b0'},
               shapes=['Small triangle: wide coat skirt, narrow shoulders, hat on top', 'Stooped posture applied at runtime (pose bias)'],
               motion=['Slow and economical; quick only when she fights'])
    return spec('ines', sk, bd, '#d9a689', g, parts, ref)


def mira():
    sk = skeleton.Skeleton(height=1.66, head=0.24, shoulder=0.17, hip=0.092, leg=0.86, knee=0.46)
    bd = bodymod.Body(sk, face='girl', build=0.45, female=1, bust=0.85, nose=0.7, hips=1.05)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#20262e', sleeves=0, neck='round', offset=0.005, hem=c.waist - 0.02, name='top'),
         W.shirt(c, '#2f8f7e', sleeves=1.9, neck='v', offset=0.014, hem=c.waist + 0.06, name='jacket', covers=False,
                 paint=band_paint('#16514a', c.waist + 0.065, 0.012)),
         W.trousers(c, '#3b3442', cuff=c.ankle_z + 0.18, loose=0.006, flare=0.0, name='leggings'),
         W.boots(c, '#4a3020', top=c.knee_z + 0.03)]
    g += W.belt(c, '#4a3020', z=c.waist - 0.04, buckle='#c0c8d0')
    parts = W.scarf(c, '#6fb84a', tails=True)
    cl = W.fringe(c, '#c9d2dc', n=6, length=0.12, spread=42, droop=0.45, curl=0.3, sweep=0.25)
    cl += W.sides_hang(c, length=0.2)
    cl += W.crown_layer(c, n=12, length=0.16, width=0.05, skip_front=52)
    parts += [W.hair_cap(c, '#c9d2dc', front=0.2, sides=0.13, back=0.07, dark='#9aa4b4', light='#eef2f6'),
              W.clumps(c, cl, '#c9d2dc', '#9aa4b4', '#eef2f6'), W.braid(c, '#c9d2dc', length=0.6, dark='#9aa4b4', light='#eef2f6')]
    ref = dict(title='Mira Sorrel', summary='18, harpoon fighter of Ashport. Sharp-tongued, sabotages the Baron\'s mines alone for three years since her brother Teo was sealed in a flooded tunnel. '
               'Silver braid, green scarf, teal jacket, harpoon.', palette={'jacket': '#2f8f7e', 'scarf': '#6fb84a', 'hair': '#c9d2dc'},
               shapes=['Lean diagonal lines: braid and scarf trail behind her'], motion=['Fast, precise, spear-dancer footwork'])
    return spec('mira', sk, bd, '#ecc4a4', g, parts, ref)


def bram():
    sk = skeleton.Skeleton(height=2.0, head=0.25, shoulder=0.245, hip=0.11, leg=0.95, knee=0.51, upperarm=0.33, forearm=0.3, hand=0.21)
    bd = bodymod.Body(sk, face='man', build=0.95, fat=0.45, belly=0.6, chest=1.15, limb=1.1, hand=1.25, nose=1.2)
    c = Ctx(sk, bd)
    stripes = lambda V, N, col: col * (1 - (np.sin(V[:, 2] * 90) > 0.4)[:, None] * 0.55)  # noqa
    # sailor's stripes: crisp navy bands, evenly spaced, with clean edges
    stripes = lambda V, N, col: col * (1 - np.clip((np.sin(V[:, 2] * 52) - 0.25) * 4, 0, 1)[:, None] * np.array([0.72, 0.58, 0.2]))  # noqa
    # a navy fisherman's knit with a cream band at the collar and cuffs (thin stripes can't be held crisply in
    # vertex colour, they smear)
    g = [W.shirt(c, '#2c3d63', sleeves=0.9, neck='round', offset=0.012, hem=c.waist - 0.22, name='shirt',
                 paint=chain(lambda V, N, col: col * (0.94 + 0.06 * (np.sin(V[:, 0] * 120) > 0)[:, None]), shade_z(c.waist - 0.2, c.neck_base, 0.1))),
         W.trousers(c, '#5a4632', cuff=c.ankle_z + 0.1, loose=0.016),
         W.boots(c, '#2e231c', top=c.ankle_z + 0.15)]
    # a cook's bib apron over the shirt and belly, front only
    parts = [W.skirt_loft(c, '#efe4c8', c.waist + 0.24, c.knee_z + 0.05, offset=0.052, flare=0.07, back_slit=1.0, name='apron', n=28,
                          paint=shade_z(c.knee_z, c.waist, 0.15), around=bd.region(['torso', 'chest', 'spine', 'hips', 'thigh.L', 'thigh.R'], 0.03))]
    parts += W.full_beard(c, '#6a4026', dark='#4a2a18', light='#8a5a36', length=0.1)
    parts += W.scarf(c, '#c95a3a', tails=False)
    ref = dict(title='Bram Oakhart', summary='34, ex-Armada sergeant turned cook of the Drowned Market. A gentle giant who feeds every refugee for free and has never forgiven himself '
               'for the ship he fired on. Bald, big brown beard, striped shirt, apron.', palette={'sweater': '#2c3d63', 'apron': '#efe4c8', 'beard': '#6a4026'},
               shapes=['A big soft circle: round belly and shoulders, tiny bald head'], motion=['Heavy, deliberate; sudden terrifying power'])
    return spec('bram', sk, bd, '#cf9874', g, parts, ref)


def nell():
    sk = skeleton.Skeleton(height=1.36, head=0.235, shoulder=0.14, hip=0.075, leg=0.66, knee=0.36, upperarm=0.21, forearm=0.19, hand=0.14, neck=0.055)
    bd = bodymod.Body(sk, face='child', build=0.25, female=0, nose=0.7)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#2a5b8a', sleeves=1.9, neck='round', offset=0.006, name='sweater'),
         W.shirt(c, '#f2c230', sleeves=1.9, neck='v', offset=0.024, hem=c.waist - 0.02, name='raincoat', covers=False,
                 paint=shade_z(c.waist, c.neck_base, 0.12)),
         W.trousers(c, '#3a3a48', cuff=c.ankle_z + 0.1, loose=0.012),
         W.boots(c, '#c23a2a', top=c.knee_z - 0.03)]
    parts = [W.skirt_loft(c, '#f2c230', c.waist - 0.02, c.knee_z + 0.02, offset=0.03, flare=0.07, front_open=0.2, name='raincoatskirt')]
    parts += W.goggles(c)
    cl = W.fringe(c, '#b8562c', n=7, length=0.105, spread=44, droop=0.35, curl=0.4)
    cl += W.crown_layer(c, n=13, length=0.16, width=0.04, skip_front=50, droop=0.7, curl=0.6, seed=2)
    for th in (150, 180, 210):
        cl.append((th, 30, 0.1, 0.035, v(math.sin(math.radians(th)) * 0.4, 0.5, -0.6), dict(curl=0.2, droop=0.4, lift=0.012)))
    for sx in (1, -1):
        cl.append((100 * sx, 30, 0.09, 0.034, v(sx * 0.7, 0.2, -0.6), dict(curl=0.25, droop=0.3, lift=0.012)))
    parts += [W.hair_cap(c, '#b8562c', front=0.2, sides=0.12, back=0.06, dark='#8a3a1c', light='#e07a42'), W.clumps(c, cl, '#b8562c', '#8a3a1c', '#e07a42')]
    ref = dict(title='Nell Finch', summary='12. Kept the Weeping Shoals light burning alone for two years after her cartographer father vanished; writes him a letter every night. '
               'Big goggles, oversized yellow raincoat, red boots.', palette={'raincoat': '#f2c230', 'boots': '#c23a2a', 'hair': '#b8562c'},
               shapes=['Round and small inside a too-big coat'], motion=['Fidgety, quick, always pointing at the sky'])
    return spec('nell', sk, bd, '#f0c8a8', g, parts, ref)


def hana():
    sk = skeleton.Skeleton(height=1.62, head=0.235, shoulder=0.165, hip=0.09)
    bd = bodymod.Body(sk, face='woman', build=0.3, female=1, bust=0.9)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#8a6a9a', sleeves=1.9, neck='round', offset=0.008, name='blouse'), W.shoes(c, '#4a3a2a')]
    parts = [W.skirt_loft(c, '#5a4a6a', c.waist + 0.02, c.ankle_z + 0.06, offset=0.02, flare=0.14, name='skirt')]
    parts += W.scarf(c, '#d8b46a', tails=False)
    parts += [W.hair_cap(c, '#2a1c18', front=0.2, sides=0.12, back=0.03, dark='#170f0c', light='#4a362e'),
              W.clumps(c, W.long_back(c, length=0.3) + W.sides_hang(c, 0.2) + W.crown_layer(c, n=12, length=0.2, width=0.05, seed=3), '#2a1c18', '#170f0c', '#4a362e')]
    ref = dict(title='Hana', summary='26, refugee in the Drowned Market. Bram fed her for years without knowing she was the girl who caught his lifebuoy.',
               palette={'blouse': '#8a6a9a', 'skirt': '#5a4a6a'}, shapes=['Soft vertical'], motion=['Gentle'])
    return spec('hana', sk, bd, '#e8b894', g, parts, ref)


def seren():
    sk = skeleton.Skeleton(height=1.68, head=0.235, shoulder=0.17, hip=0.09)
    bd = bodymod.Body(sk, face='woman', build=0.35, female=1, bust=0.9)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#e8e2d4', sleeves=1.9, neck='v', offset=0.008, name='shirt'),
         W.shirt(c, '#3a5a7a', sleeves=1.9, neck='v', offset=0.02, hem=c.waist - 0.03, name='oilskin', covers=False),
         W.trousers(c, '#3a3428', cuff=c.ankle_z + 0.1), W.boots(c, '#2a1e1a', top=c.knee_z - 0.05)]
    parts = [W.skirt_loft(c, '#3a5a7a', c.waist - 0.02, c.knee_z + 0.05, offset=0.03, flare=0.08, front_open=0.2, name='oilskinskirt')]
    parts += [W.hair_cap(c, '#1e2632', front=0.21, sides=0.12, back=0.04, dark='#121820', light='#34425a'),
              W.clumps(c, W.long_back(c, length=0.42, n=11) + W.sides_hang(c, 0.3) + W.fringe(c, '#1e2632', n=5, length=0.1, spread=30, sweep=-0.3) + W.crown_layer(c, n=12, length=0.24, width=0.05, seed=4),
                       '#1e2632', '#121820', '#34425a')]
    ref = dict(title='Seren Marlowe', summary="Kai's mother, keeper of the Gull's Rest light. Seen only in memory: rowing into the Great Squall with her storm lantern.",
               palette={'oilskin': '#3a5a7a', 'hair': '#1e2632'}, shapes=['Long dark hair, the same dark-blue as Kai'], motion=['Calm, certain'])
    return spec('seren', sk, bd, '#e6b490', g, parts, ref)


def teo():
    sk = skeleton.Skeleton(height=1.32, head=0.235, shoulder=0.14, hip=0.075, leg=0.64, knee=0.35, upperarm=0.2, forearm=0.18, hand=0.13, neck=0.05)
    bd = bodymod.Body(sk, face='child', build=0.2)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#9a8a72', sleeves=0.8, neck='round', offset=0.008, name='shirt', paint=shade_z(c.waist, c.neck_base, 0.3)),
         W.trousers(c, '#4a4036', cuff=c.knee_z - 0.05, loose=0.014), W.shoes(c, '#3a2e24')]
    parts = W.hat_cap(c, '#5a5046', band='#3a342e', badge='#5a5046', lift=0.035)
    # under the cap: thin hair, a fringe and a few locks poking out at the sides and back
    # rooted just under the cap's rim (a fringe rooted on the crown combs out over the cap)
    tufts = [(th, 30, L, w, d, {**kw, 'cap': 0.012}) for th, ph, L, w, d, kw in W.fringe(c, '#c9d2dc', n=5, length=0.065, spread=36)]
    for th in (95, 140, 180, 220, 265):
        a = math.radians(th)
        tufts.append((th, 18, 0.07, 0.035, v(math.sin(a) * 0.5, 0.3, -0.9), dict(curl=0.3, droop=0.4, release=0.12, cap=0.012)))
    parts += [W.hair_cap(c, '#c9d2dc', front=0.2, sides=0.12, back=0.06, dark='#9aa4b4', light='#eef2f6', thick=0.012, strands=0),
              W.clumps(c, tufts, '#c9d2dc', '#9aa4b4', '#eef2f6')]
    ref = dict(title='Teo Sorrel', summary="Mira's little brother. Eleven when the Baron sealed the flooded tunnel. Appears as a memory.",
               palette={'shirt': '#9a8a72', 'cap': '#5a5046', 'hair': '#c9d2dc (like Mira)'}, shapes=['Small, cap too big'], motion=['Bouncy'])
    return spec('teo', sk, bd, '#eec6a6', g, parts, ref)


def villager():
    sk = skeleton.Skeleton(height=1.72, head=0.24, shoulder=0.185)
    bd = bodymod.Body(sk, face='man', build=0.45, fat=0.3, nose=1.1)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#d8c8a0', sleeves=1.2, neck='v', offset=0.01, name='shirt'),
         W.trousers(c, '#6a5a44', cuff=c.ankle_z + 0.12, loose=0.016), W.shoes(c, '#4a3a2a')]
    parts = [W.mustache(c, '#5a3a26')] + spiky_short(c, '#5a3a26', '#3a2416', '#7a5236')
    ref = dict(title='Villager', summary='Gull\'s Rest fisherfolk and Ashport dockers.', palette={'shirt': '#d8c8a0'}, shapes=['Soft'], motion=['Everyday'])
    return spec('villager', sk, bd, '#d9a27e', g, parts, ref)


# ============================================================================================ bosses

def halvard():
    sk = skeleton.Skeleton(height=1.94, head=0.235, shoulder=0.21, leg=0.98, knee=0.52, upperarm=0.31, forearm=0.28)
    bd = bodymod.Body(sk, face='man', build=0.7, jaw=1.2, chin=1.15, nose=1.1)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#f6f3ea', sleeves=1.9, neck='round', offset=0.014, hem=c.waist - 0.05, name='coat',
                 paint=chain(band_paint('#d8a93c', c.waist - 0.045, 0.01), shade_z(c.waist, c.neck_base, 0.1))),
         W.trousers(c, '#1f2a4c', cuff=c.knee_z - 0.04, loose=0.01, flare=0.003),
         W.boots(c, '#141014', top=c.knee_z + 0.03)]
    g += W.belt(c, '#d8a93c', z=c.waist - 0.03, buckle='#fff2c0')
    parts = [W.skirt_loft(c, '#f6f3ea', c.waist - 0.03, c.knee_z - 0.06, offset=0.03, flare=0.12, front_open=0.3, name='coattail',
                          paint=band_paint('#d8a93c', c.knee_z - 0.05, 0.014))]
    parts += W.epaulettes(c)
    parts.append(W.cape(c, '#1f2a4c', length=0.95, width=0.42))
    parts += W.hat_bicorne(c, '#1a1c28')
    parts += [W.hair_cap(c, '#e2c27a', front=0.2, sides=0.12, back=0.06, dark='#b8964e', light='#f8e6b0')]
    ref = dict(title='Commodore Halvard Crane', summary="Vale's enforcer, 'the Iron Gull'. Burned Gull's Rest; ordered the volley Bram still dreams about. Halberd, white coat, navy cape, bicorne.",
               palette={'coat': '#f6f3ea', 'cape': '#1f2a4c', 'gold': '#d8a93c', 'hair': '#e2c27a'},
               shapes=['Tall vertical with a sweeping cape triangle', 'The halberd extends his reach: he owns the space around him'],
               motion=['Precise, contemptuous, wide sweeping arcs'])
    return spec('halvard', sk, bd, '#e8b896', g, parts, ref)


def gorrick():
    sk = skeleton.Skeleton(height=1.96, head=0.25, shoulder=0.25, hip=0.12, leg=0.88, knee=0.47, upperarm=0.31, forearm=0.29, hand=0.2)
    bd = bodymod.Body(sk, face='brute', build=0.7, fat=0.9, belly=1.0, chest=1.1, limb=1.2, hand=1.2, nose=1.4)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#e8e0d0', sleeves=1.9, neck='round', offset=0.01, name='shirt'),
         W.shirt(c, '#7a1f2a', sleeves=0, neck='v', offset=0.03, hem=c.waist - 0.08, name='waistcoat', covers=False,
                 paint=shade_z(c.waist - 0.08, c.neck_base, 0.15)),
         W.trousers(c, '#2c2a30', cuff=c.ankle_z + 0.08, loose=0.02, flare=0.01),
         W.boots(c, '#1a1614', top=c.ankle_z + 0.16)]
    g += W.belt(c, '#1a1614', z=c.waist - 0.08, buckle='#d8b24a')
    parts = W.hat_top(c, '#1a1a20', band='#7a1f2a')
    parts.append(W.mustache(c, '#3a2a22'))
    # iron right arm: plates along the forearm and a big fist
    el, wr = c.j['elbow.R'], c.j['wrist.R']
    fd = norm(wr - el)
    plates = [pc.quad_sphere(el + fd * (0.07 * i), (0.07, 0.07, 0.06), res=3) for i in range(4)]
    fist = pc.quad_sphere(wr + fd * 0.08, (0.09, 0.09, 0.1), res=3)
    parts.append(P.Part('ironarm', *W._merge(plates + [fist]), hexc('#5c6470'), cls='metal', weights=('rigid', 'forearm.R')))
    ref = dict(title='Baron Gorrick Vane', summary='Master of the Ashport mines. Sealed a flooded tunnel with children inside to save the ore. Top hat, red waistcoat, iron arm, chains.',
               palette={'waistcoat': '#7a1f2a', 'hat': '#1a1a20', 'iron': '#5c6470'}, shapes=['A huge round mass on short legs, top hat on top'],
               motion=['Lumbering, then horribly fast with the chains'])
    return spec('gorrick', sk, bd, '#d49a7e', g, parts, ref)


def vale():
    sk = skeleton.Skeleton(height=1.9, head=0.235, shoulder=0.205, leg=0.97, knee=0.52)
    bd = bodymod.Body(sk, face='man', build=0.55, jaw=1.1, chin=1.1, nose=1.05)
    c = Ctx(sk, bd)
    g = [W.shirt(c, '#fbfaf5', sleeves=1.9, neck='round', offset=0.016, hem=c.waist - 0.05, name='greatcoat',
                 paint=chain(band_paint('#e8c25a', c.waist - 0.045, 0.012), shade_z(c.waist, c.neck_base, 0.08))),
         W.trousers(c, '#fbfaf5', cuff=c.knee_z - 0.05, loose=0.01, flare=0.003),
         W.boots(c, '#121014', top=c.knee_z + 0.04)]
    g += W.belt(c, '#e8c25a', z=c.waist - 0.03, buckle='#ffffff')
    parts = [W.skirt_loft(c, '#fbfaf5', c.waist - 0.03, c.ankle_z + 0.15, offset=0.03, flare=0.18, front_open=0.32, name='greatcoatskirt',
                          paint=band_paint('#e8c25a', c.ankle_z + 0.16, 0.014))]
    parts += W.epaulettes(c, '#e8c25a')
    parts.append(W.buttons(c, '#e8c25a', c.waist + 0.04, c.neck_base - 0.06, n=5, y=-0.12, x=0.05))
    cl = [(th, 60, 0.16, 0.036, v(math.sin(math.radians(th)) * 0.3, 0.9, -0.2), dict(curl=0.3, droop=0.2, lift=0.012)) for th in (-30, -10, 10, 30)]
    cl += W.long_back(c, length=0.32, n=7, spread=60, droop=0.7)
    parts += [W.hair_cap(c, '#dfe4ea', front=0.21, sides=0.13, back=0.05, dark='#a9b2bd', light='#ffffff'), W.clumps(c, cl, '#dfe4ea', '#a9b2bd', '#ffffff')]
    ref = dict(title='Grand Admiral Severin Vale', summary='Lost his wife and his daughter Lissa when the Great Squall sank their ferry. Wants the Sunken Crown to still the sea forever. '
               'Silver hair swept back, white greatcoat with gold epaulettes, a sabre; later the Crown.',
               palette={'greatcoat': '#fbfaf5', 'gold': '#e8c25a', 'hair': '#dfe4ea'}, shapes=['A tall white column with a long flared coat: stillness itself'],
               motion=['Minimal, exact, never wasted; grief in the shoulders'])
    return spec('vale', sk, bd, '#e6bc9e', g, parts, ref)


CAST = {'marine': marine, 'rifleman': rifleman, 'elite': elite, 'brute': brute, 'thug': thug, 'wrecker': wrecker,
        'ines': ines, 'mira': mira, 'bram': bram, 'nell': nell, 'hana': hana, 'seren': seren, 'teo': teo, 'villager': villager,
        'halvard': halvard, 'gorrick': gorrick, 'vale': vale}
