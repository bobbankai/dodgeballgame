# Conventions
- Blender axes: x, y, z = three.js (x, z, -y). Characters face +Z in game; left hand is +X.
- Gear pieces are SDF fields (sdf.py) via `Piece(name, field, bounds, mats, skin=..., voxel, budget)`; skin keys: dict {'bone','blend'}, 'transfer', 'transfer_skirt', None.
- Material IDs: `armor.MATERIALS` list + `mat_color` (4-level blue encoding, max 64); looks live in gearmat.LOOKS / EMISSIVE. New looks need the texture set in tools/tex/textures.json.
- Environment pieces: `kit.box()` for hand-made blocks; `sculpt()` for scenery. Shell `finish(name, parts, cols)` writes public/assets/env/<set>/<name>.glb.
- Game: levels subclass Level with load()/start(checkpoint)/atmosphere(); bosses are BossDef objects in src/ai/bosses/*. Story scripts are async Director functions passed to `g.cine.play` (queued if another runs).
- Dev log is docs/DEVLOG.md; add new session entries at the top.