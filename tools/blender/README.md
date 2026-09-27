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
| `npm run assets:ball` | `bake_ball.py` | `src/assets/textures/ball_{albedo,normal,orm}.png` |

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

### The ball (`bake_ball.py`)

A 327k-vertex icosphere is displaced with pebbled foam-rubber grain (spherical Voronoi domes)
and grooved seams along the stripe edges, then baked onto a sphere built with exactly the
vertex/UV layout of `THREE.SphereGeometry`, so the equirectangular maps line up with no
conversion: object-space normals (three.js axes, Y up), occlusion + roughness packed as glTF
ORM, and an analytically painted albedo. The game composites the printed logo onto the albedo
at load (`src/rendering/Textures.ts`).
