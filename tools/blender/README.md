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
| `npm run assets:props` | `build_props.py` | `src/assets/models/props.glb` |
| `npm run bake:lighting [ids…]` | `bake_irradiance.py` (driven by `tools/bake-lighting.cjs`) | `src/assets/lighting/<arena>.{json,bin}` |

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

### Arena prop kit (`build_props.py`)

Hoops (truss mount, framed backboard, rim on a bracket and a corded net), a caster ball cart
with `ball_slot_*` empties the game fills with real balls, a cooler on its stand, cones, a
folded mat stack and a slatted bench. Everything is modelled in metres with bevelled edges;
Cycles ambient occlusion is baked into per-vertex colours (no textures), and the kit exports
as a single GLB that the arenas clone (`src/levels/PropKit.ts`). Props face Blender -Y, i.e.
three.js +Z.

### Baked global illumination (`bake_irradiance.py`)

The dev server exports each arena's static geometry, material albedo/emission and lights
(`exportArenaForBake` in `src/levels/LightBake.ts`); Blender rebuilds the scene with lamps
calibrated to three.js units (point power = 4π·intensity, sun strength = lux) and bakes
diffuse irradiance on a grid of probes with Cycles. Probes buried in geometry are detected
with back-face ray tests and filled from their neighbours. The result is projected to L2
spherical harmonics and stored as half floats, which the game loads into three.js's
`LightProbeGrid` in place of the flat hemisphere fill, so bounce light, colour bleeding and
large-scale occlusion come for free at runtime.

```sh
npm run dev &                         # the driver reads arenas from the running game
npm run bake:lighting                 # all arenas, or: npm run bake:lighting -- rec school
npm run bake:lighting -- rec --samples 128 --max-probes 6000
```
