"""Builds the five fighters of The Tenth Bell and exports one GLB each (mesh, rig, face morphs, clips).

  /opt/bl/venv/bin/python tenthbell/tools/blender/build_chars.py [name ...] [--noanim] < /dev/null

Everything is generated: MPFB shapes the bodies, the rest (skin, eyes, hair, clothes, clips) is made here.
Cloth and hair materials carry no textures: the game's material library builds them from the 'tb' extras.
"""
import json
import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from PIL import Image, ImageDraw
import hair
import human
import outfit
import parts
import skin
import tex
from human import group_mask
from outfit import garment, limb_cut

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'chars'))


def cloth(name, t, c, s=14.0, r=1.0, **kw):
    return tex.material(name, base=tex.hexc(c), rough=0.7, tb={'k': 'cloth', 't': t, 'c': c, 's': s, 'r': r, **kw})


def zs(R):
    return dict(pel=R['spine05'][0][2], s3=R['spine03'][0][2], s2=R['spine02'][0][2], s1=R['spine01'][0][2], neck=R['neck01'][0][2])


def wraps(body, R, name, mat, forearm=1.5):
    """hand wraps: forearm to knuckles, thumb and fingers left free"""
    cuts = [limb_cut(R, f'lowerarm01.{s}', f'wrist.{s}', forearm - 1, 0.1) for s in 'LR']
    return garment(body, R, name, lambda f: f.on('wrist', 'metacarpal') | (f.on('lowerarm') & (f.arm > forearm)), mat, offset=0.0016, rim=0.002, cuts=cuts)


def anklets(body, R, name, mat, shin=1.62, foot=0.5):
    cuts = [limb_cut(R, f'lowerleg01.{s}', f'foot.{s}', shin - 1, 0.1) for s in 'LR']
    return garment(body, R, name, lambda f: (f.on('lowerleg') & (f.leg > shin)) | (f.on('foot', 'toe') & (f.foot < foot)), mat, offset=0.0016, rim=0.002, cuts=cuts)


def scoop(z, depth=0.085, fwd=-0.075):
    return lambda f: f.near((0, fwd, z['neck'] - 0.005), depth)


# ---------------------------------------------------------------- Kessa
def kessa_outfit(body, tights, R):
    z = zs(R)
    zw = z['pel'] + 0.085
    black = cloth('kessa_top', 'bi_stretch', '#0f1013', 18)
    red = cloth('kessa_red', 'crepe_satin', '#8f1420', 16, 0.8, sheen=0.5)
    gold = cloth('kessa_gold', 'bi_stretch', '#b48a3a', 22, 0.7)
    wrap = cloth('kessa_wrap', 'rough_linen', '#a01c26', 26)
    zt, zh = z['s2'] + 0.065, R['lowerleg01.L'][0][2] + 0.2
    top = garment(tights, R, 'top', lambda f: f.torso & (f.z > zt) & ~f.armholes(0.09), black, offset=0.004, zcuts=[zt, zt + 0.03],
                  bands=[(lambda g: g.z < zt + 0.03, red)])
    shorts = garment(tights, R, 'shorts', lambda f: (f.z < zw) & (f.z > zh), red, offset=0.012, smooth=3, relax=0.005, flare=0.022,
                     zcuts=[zw, zw - 0.045, zh, zh + 0.03], bands=[(lambda g: g.z > zw - 0.045, gold), (lambda g: g.z < zh + 0.03, black)])
    return [top, shorts, wraps(body, R, 'wraps', wrap), anklets(body, R, 'anklets', cloth('kessa_ankle', 'bi_stretch', '#0f1013', 20))]


def kessa_hair(body, rig, R, spec):
    e = R['eye.L'][0]
    return hair.puff('puff', (0, e[1] + 0.175, e[2] + 0.08), 0.076, spec['hair_color'], squash=(1.1, 0.95, 0.98), seed=4)


# ---------------------------------------------------------------- Dee
def dee_outfit(body, tights, R):
    z = zs(R)
    zw = z['pel'] + 0.10
    white = cloth('dee_trunks', 'crepe_satin', '#d9d4c8', 16, 0.85, sheen=0.5)
    gold = cloth('dee_gold', 'bi_stretch', '#a8802e', 22, 0.7)
    tape = cloth('dee_tape', 'rough_linen', '#cfc8b8', 26)
    hipx = abs(R['upperleg01.L'][0][0])
    zh = R['lowerleg01.L'][0][2] + 0.11
    trunks = garment(tights, R, 'trunks', lambda f: (f.z < zw) & (f.z > zh), white, offset=0.014, smooth=4, relax=0.006, flare=0.03,
                     zcuts=[zw, zw - 0.06, zh], bands=[(lambda g: g.z > zw - 0.06, gold), (lambda g: (np.abs(g.x) > hipx + 0.05) & (g.z < zw - 0.06), gold)])
    ribs = garment(tights, R, 'ribtape', lambda f: f.torso & (f.z > z['s2'] - 0.005) & (f.z < z['s2'] + 0.13), tape, offset=0.003, rim=0.002,
                   zcuts=[z['s2'] - 0.005, z['s2'] + 0.13])
    return [trunks, ribs, wraps(body, R, 'wraps', tape, 1.42), anklets(body, R, 'anklets', tape, 1.7, 0.42)]


def dee_hair(body, rig, R, spec):
    e = R['eye.L'][0]
    sc = group_mask(body, 'scalp')
    faces = np.array([all(sc[v] for v in p.vertices) and p.center.z > e[2] + 0.07 for p in body.data.polygons])
    return [hair.shells(body, faces, 'fade', 6, 0.013, spec['hair_color'], uv_scale=14, density=1.0,
                        length_fn=lambda c: tex.smooth(e[2] + 0.075, e[2] + 0.115, c[:, 2]))]


# ---------------------------------------------------------------- Rook
def rook_outfit(body, tights, R):
    z = zs(R)
    zw = z['pel'] + 0.07
    tank = cloth('rook_tank', 'cotton_jersey', '#1b1c1f', 16)
    cargo = cloth('rook_cargo', 'denim_fabric_04', '#3c4030', 9)
    leather = cloth('rook_leather', 'brown_leather', '#1a1512', 8, 0.8, k2='leather')
    rubber = tex.material('rook_sole', base=(0.02, 0.02, 0.02), rough=0.85, tb={'k': 'pbr', 'c': '#0a0a0a', 'r': 0.85})
    zb = R['foot.L'][0][2] + 0.2
    top = garment(tights, R, 'tank', lambda f: f.torso & (f.z > zw - 0.03) & ~scoop(z, 0.095)(f) & ~f.armholes(0.085), tank, offset=0.007, smooth=1, zcuts=[zw - 0.03])
    pants = garment(tights, R, 'cargo', lambda f: (f.z < zw) & (f.z > zb - 0.05), cargo, offset=0.022, smooth=6, relax=0.008,
                    zcuts=[zw, zw - 0.04, zb - 0.05], bands=[(lambda g: g.z > zw - 0.04, leather)])
    boots = garment(tights, R, 'boots', lambda f: f.z < zb, leather, offset=0.008, smooth=2, relax=0.003, rim=0.006, zcuts=[zb])
    outfit.soles(boots, 0.014, rubber)
    gloves = garment(body, R, 'gloves', lambda f: f.on('wrist', 'metacarpal') | (f.on('lowerarm') & (f.arm > 1.78)), leather, offset=0.0025, rim=0.003)
    return [top, pants, boots, gloves]


def rook_hair(body, rig, R, spec):
    e = R['eye.L'][0]
    co = np.array([v.co[:] for v in body.data.vertices])
    lips = group_mask(body, 'lips')
    mouth = co[lips].mean(0)
    chin = co[(np.abs(co[:, 0]) < 0.01) & (co[:, 2] < mouth[2] - 0.02) & (co[:, 2] > mouth[2] - 0.07)]
    zchin = chin[:, 2][np.argmin(chin[:, 1])] if len(chin) else mouth[2] - 0.04

    def is_beard(p):
        c = p.center
        if p.material_index != 1 or any(lips[v] for v in p.vertices):
            return False
        front = c.y < e[1] + 0.092 - 0.25 * max(0.0, c.z - mouth[2])       # stops before the ear, sideburn tapers
        return front and zchin - 0.045 < c.z < mouth[2] + 0.024 - 0.012 * (abs(c.x) > 0.022) + 0.03 * (abs(c.x) > 0.045)

    faces = np.array([is_beard(p) for p in body.data.polygons])
    grow = lambda c: 0.45 + 0.55 * tex.smooth(mouth[2] + 0.02, zchin - 0.01, c[:, 2])
    return [hair.shells(body, faces, 'beard', 10, 0.042, spec['beard_color'], uv_scale=10, sag=0.026, taper=1.1, length_fn=grow, density=0.75, seed=9)]


# ---------------------------------------------------------------- Wren
def wren_outfit(body, tights, R):
    z = zs(R)
    zw = z['pel'] + 0.09
    teal = cloth('wren_teal', 'bi_stretch', '#0f5a5e', 20, 0.85)
    black = cloth('wren_black', 'bi_stretch', '#0c0d10', 20, 0.85)
    white = cloth('wren_wrap', 'rough_linen', '#d8d2c4', 26)
    hipx = abs(R['upperleg01.L'][0][0])
    zt, za = z['s3'] + 0.03, R['foot.L'][0][2] + 0.075
    top = garment(tights, R, 'top', lambda f: f.torso & (f.z > zt) & ~f.armholes(0.08), teal, offset=0.0035, zcuts=[zt, zt + 0.025, z['neck'] - 0.065],
                  bands=[(lambda g: g.z < zt + 0.025, black), (lambda g: g.z > z['neck'] - 0.065, black)])
    legs = garment(tights, R, 'leggings', lambda f: (f.z < zw) & (f.z > za), black, offset=0.003, zcuts=[zw, zw - 0.035, za],
                   bands=[(lambda g: (np.abs(g.x) > hipx + 0.035 + 0.02 * np.clip(g.leg, 0, 2)) & (g.z < zw - 0.035), teal), (lambda g: g.z > zw - 0.035, teal)])
    acuts = [limb_cut(R, f'lowerarm01.{s}', f'wrist.{s}', t, 0.1) for s in 'LR' for t in (0.06, 0.12, 0.86, 0.93)]
    sleeves = garment(tights, R, 'sleeves', lambda f: (f.arm > 1.06) & (f.arm < 1.93), teal, offset=0.003, rim=0.002, cuts=acuts,
                      bands=[(lambda g: (g.arm < 1.12) | (g.arm > 1.86), black)])
    return [top, legs, sleeves, anklets(body, R, 'anklets', white, 1.66, 0.45)]


def wren_hair(body, rig, R, spec):
    e = R['eye.L'][0]
    z = zs(R)
    path = [(0, e[1] + 0.19, e[2] + 0.02), (0, e[1] + 0.225, e[2] - 0.06), (0, e[1] + 0.225, z['s1'] + 0.03), (0, e[1] + 0.25, z['s1'] - 0.1),
            (0, e[1] + 0.245, z['s2'] - 0.02), (0, e[1] + 0.23, z['s3'] - 0.06)]
    return [hair.braid(rig, 'braid', path, 0.024, spec['hair_color'], bones=8)]


# ---------------------------------------------------------------- Crane
def crane_outfit(body, tights, R):
    z = zs(R)
    zw = z['pel'] + 0.095
    shirt_m = cloth('crane_shirt', 'stretch_poplin', '#d8d4cc', 22)
    wool = cloth('crane_wool', 'poly_wool_herringbone', '#2a2b30', 10, d=1)
    leather = cloth('crane_leather', 'fabric_leather_02', '#0d0c0c', 8, 0.55, k2='leather')
    tape = cloth('crane_tape', 'rough_linen', '#121214', 26)
    rubber = tex.material('crane_sole', base=(0.02, 0.02, 0.02), rough=0.8, tb={'k': 'pbr', 'c': '#0a0a0a', 'r': 0.8})
    zs_ = R['foot.L'][0][2] + 0.035
    ecuts = [limb_cut(R, f'lowerarm01.{s}', f'wrist.{s}', 0.04, 0.1) for s in 'LR']
    shirt = garment(tights, R, 'shirt', lambda f: (f.z > zw - 0.06) & (f.torso | ((f.arm > -0.6) & (f.arm < 1.04))) & ~scoop(z, 0.07, -0.085)(f), shirt_m,
                    offset=0.008, smooth=3, relax=0.004, rim=0.005, zcuts=[zw - 0.06], cuts=ecuts)
    vest = garment(tights, R, 'vest', lambda f: f.torso & (f.z > zw - 0.075) & ~f.near((0, -0.11, z['neck'] - 0.03), 0.15) & ~f.armholes(0.09), wool, offset=0.017, smooth=4, relax=0.004, rim=0.005,
                   zcuts=[zw - 0.075])
    trousers = garment(tights, R, 'trousers', lambda f: (f.z < zw) & (f.z > zs_ + 0.01), wool, offset=0.019, smooth=6, relax=0.007, flare=0.01,
                       zcuts=[zw, zw - 0.036, zs_ + 0.01], bands=[(lambda g: g.z > zw - 0.036, leather)])
    shoes = garment(tights, R, 'shoes', lambda f: f.z < zs_ + 0.03, leather, offset=0.006, smooth=2, relax=0.003, rim=0.005, zcuts=[zs_ + 0.03])
    outfit.soles(shoes, 0.012, rubber)
    return [shirt, vest, trousers, shoes, garment(body, R, 'tape', lambda f: f.on('wrist', 'metacarpal'), tape, offset=0.0016, rim=0.002)]


def bells(n=9):
    """Crane's tally: one bell inked for every fighter he has broken"""
    im = Image.new('L', (n * 56 + 12, 96), 0)
    d = ImageDraw.Draw(im)
    for i in range(n):
        x = 12 + i * 56
        d.pieslice([x, 14, x + 40, 70], 180, 360, fill=255)
        d.polygon([(x, 42), (x + 40, 42), (x + 46, 66), (x - 6, 66)], fill=255)
        d.ellipse([x + 14, 66, x + 26, 80], fill=255)
        d.rectangle([x + 17, 6, x + 23, 16], fill=255)
    return im


SPECS = {
    'kessa': dict(seed=3, phenotype=dict(gender=0.0, age=0.48, muscle=0.84, weight=0.44, height=0.56, proportions=0.78, cupsize=0.34, firmness=0.7,
                                         race=dict(african=0.86, asian=0.04, caucasian=0.10)),
                  targets=[('head-oval', 0.35), ('chin-width-decr', 0.25), ('l-cheek-bones-incr', 0.3), ('r-cheek-bones-incr', 0.3), ('mouth-scale-horiz-decr', 0.15)],
                  skin=dict(tone='#77482f', lips='#7c3b3e', palm='#c08a70'), hair_color='#0d0a09', scalp=1.0, scalp_style='rows',
                  brows=dict(thick=0.8, arch=1.15, alpha=0.85), eyes=dict(color='#3a2110'), outfit=kessa_outfit, hair=kessa_hair),
    'dee': dict(seed=5, phenotype=dict(gender=1.0, age=0.54, muscle=0.86, weight=0.5, height=0.54, proportions=0.7, race=dict(african=0.86, asian=0.04, caucasian=0.10)),
                targets=[('head-rectangular', 0.3), ('chin-prominent-incr', 0.2)],
                skin=dict(tone='#673d28', lips='#5e3030', palm='#b98468'), hair_color='#0b0908', scalp=0.85, scalp_style='buzz', stubble=0.6,
                brows=dict(thick=1.2, arch=0.7), eyes=dict(color='#34200f', L=dict(cloudy=0.8)), wrinkles=0.25,
                scars=[dict(line=[(0.010, 0.042), (0.015, 0.02), (0.021, -0.032)], width=2.6, rel='eyeL')],
                bruises=[dict(bone='spine02', off=(0.11, -0.10, 0.04), r=0.075), dict(bone='spine02', off=(-0.13, -0.07, -0.02), r=0.05, a=0.6),
                         dict(bone='upperarm02.R', off=(-0.03, -0.02, 0.0), r=0.045, a=0.6)],
                outfit=dee_outfit, hair=dee_hair),
    'rook': dict(seed=7, phenotype=dict(gender=1.0, age=0.63, muscle=0.97, weight=0.8, height=0.67, proportions=0.42, race=dict(african=0.03, asian=0.02, caucasian=0.95)),
                 targets=[('head-square', 0.5), ('chin-width-incr', 0.4), ('nose-width2-incr', 0.3), ('neck-scale-horiz-incr', 0.5)],
                 skin=dict(tone='#c68e74', lips='#a6605a', palm='#d8a48e', freckles=0.6), hair_color='#6b3418', beard_color='#7a3a18', scalp=0.22, scalp_style='buzz',
                 stubble=0.7, brows=dict(thick=1.5, arch=0.5, density=1.2), eyes=dict(color='#5c5a30'), wrinkles=0.55, outfit=rook_outfit, hair=rook_hair),
    'wren': dict(seed=11, phenotype=dict(gender=0.0, age=0.47, muscle=0.72, weight=0.36, height=0.615, proportions=0.8, cupsize=0.3, firmness=0.7,
                                         race=dict(african=0.03, asian=0.9, caucasian=0.07)),
                 targets=[('head-oval', 0.3), ('chin-triangle', 0.25)],
                 skin=dict(tone='#d2a686', lips='#ad5f68', palm='#e0b8a2'), hair_color='#0a0909', scalp=1.0, scalp_style='sleek',
                 brows=dict(thick=0.75, arch=0.9), eyes=dict(color='#231409'), outfit=wren_outfit, hair=wren_hair),
    'crane': dict(seed=13, phenotype=dict(gender=1.0, age=0.72, muscle=0.8, weight=0.6, height=0.63, proportions=0.62, race=dict(african=0.03, asian=0.12, caucasian=0.85)),
                  targets=[('head-diamond', 0.3), ('nose-hump-incr', 0.5), ('chin-prominent-incr', 0.3), ('l-cheek-bones-incr', 0.4), ('r-cheek-bones-incr', 0.4)],
                  skin=dict(tone='#b98568', lips='#8e5650', palm='#cf9f88'), hair_color='#8f8f8c', scalp=0.92, scalp_style='sleek', stubble=0.4,
                  brows=dict(thick=1.25, arch=0.6), eyes=dict(color='#7f909c'), wrinkles=1.0,
                  scars=[dict(line=[(0.016, -0.018), (0.024, -0.038), (0.032, -0.058)], width=3.0, rel='eyeR')],
                  tattoos=[dict(bone='lowerarm01.L', end='wrist.L', t=(0.12, 0.92), angle=-70, span=70, image=bells())],
                  outfit=crane_outfit, hair=lambda body, rig, R, spec: []),
}


def bind(o, rig):
    o.parent = rig
    if not any(m.type == 'ARMATURE' for m in o.modifiers):
        o.modifiers.new('Armature', 'ARMATURE').object = rig


def build(name, anims=True):
    t0 = time.time()
    spec = dict(SPECS[name], name=name)
    human.reset()
    base, rig = human.make_human(spec)
    R = human.rest(rig)
    tights = human.split_off(base, group_mask(base, 'helper-tights'), 'tights')
    tights.shape_key_clear()
    eye_objs = parts.eyes(base, rig, spec)
    mouth = parts.mouth_parts(base)
    body = human.split_off(base, group_mask(base, 'body'), 'body')
    spec['_rim'] = parts.eyelid_rim(base)
    lash = parts.lashes(base, spec['_rim'])
    bpy.data.objects.remove(base)
    for o in [tights, lash] + mouth:
        o.hide_render = True
    box, pad = skin.split_head(body)
    scars = []
    for sc in spec.get('scars', []):  # scar lines are given from an eye: (metres towards the ear, metres up)
        e, sgn = (R['eye.L'][0], 1) if sc['rel'] == 'eyeL' else (R['eye.R'][0], -1)
        scars.append(dict(sc, line=[(e[0] + sgn * dx, e[2] + dz) for dx, dz in sc['line']]))
    spec['scars'] = scars
    maps = skin.paint(body, R, spec, box, pad, name)
    for slot in (0, 1):
        a, n, o = maps[slot]
        body.material_slots[slot].material = tex.material(f'{name}_skin_{"body" if slot == 0 else "head"}', base=a, normal=n, orm=o, tb={'k': 'skin'})
    body.material_slots[2].material = tex.material('mouth', base=(0.10, 0.02, 0.02), rough=0.35, tb={'k': 'pbr', 'c': '#3a0d0d', 'r': 0.35})
    for o in [lash] + mouth:
        o.hide_render = False
    garments = spec['outfit'](body, tights, R)
    hairs = spec['hair'](body, rig, R, spec)
    outfit.hide_skin(body, garments)
    bpy.data.objects.remove(tights)
    for o in eye_objs + hairs:
        bind(o, rig)
    rig.name = name
    os.makedirs(OUT, exist_ok=True)
    R2 = human.rest(rig)
    json.dump({k: (v[0].tolist(), v[1].tolist(), v[2].tolist(), v[3]) for k, v in R2.items()}, open(f'/opt/work/rest_{name}.json', 'w'))
    if anims:
        import clips
        import pose
        meta = dict(name=name, scale=round(pose.Rig(R2).scale, 4), height=round(float(R2['head'][1][2]), 3), eye=round(float(R2['eye.L'][0][2]), 3),
                    chest=round(float(R2['spine01'][0][2]), 3), clips=clips.bake_all(rig, R2, spec))
        json.dump(meta, open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'))
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=True, export_morph=True,
                              export_morph_normal=False, export_tangents=False, export_image_format='WEBP', export_image_quality=88, export_extras=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=False,
                              export_animations=anims, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
    print(f'BUILT {name}: {os.path.getsize(path) / 1e6:.2f} MB, {tris} tris, {len(rig.data.bones)} bones, {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    code = 0
    try:
        for n in args or list(SPECS):
            build(n, anims='--noanim' not in sys.argv)
    except Exception:  # bpy hangs at interpreter shutdown after an error: report and leave hard
        import traceback
        traceback.print_exc()
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
