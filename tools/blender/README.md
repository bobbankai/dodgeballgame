# Blender asset pipeline

Some assets are generated offline with a headless Blender (4.5 LTS) and committed to the repo,
so the game itself never needs Blender. Re-run a step only when you change its script.

## Setup

```sh
npm run blender:install        # downloads Blender 4.5 LTS to /opt/blender (idempotent)
```

Any Blender ≥ 4.2 on `PATH` also works.

## Steps

| Command | Script | Output |
| --- | --- | --- |
| `npm run assets:details` | `bake_details.py` | `src/assets/textures/{knit,twill,skin,pebble}.png` |

### Detail textures (`bake_details.py`)

Tileable 512² micro-detail maps: tangent-space normal in RGB (OpenGL convention), ambient
occlusion in A.

- **knit** / **twill** are modelled as real yarn (Bezier tubes, interlocking stitches, wrapped
  copies across the tile edges) and baked with Cycles onto a flat tile.
- **skin** (pores + creases) and **pebble** (foam-rubber grain) are periodic height fields
  (Fourier noise, wrapped Voronoi) converted analytically.

The character shader maps them triplanar in the sculpt's bind space and carries the frame
through skinning, so the detail sticks to cloth and skin as limbs move
(`src/character/CharacterMaterial.ts`, per-slot settings in `setAppearance`).

`lib.py` holds the shared helpers (scene reset, Cycles bake of geometry onto a tile, periodic
noise/Voronoi, height → normal).
