# Third-party assets and tools (licence ledger)

Every downloaded asset and tool is recorded here with its source and licence before it is used. Raw downloads live in `vendor/`
(git-ignored, re-fetchable with the scripts in `tools/assets/`); only processed game assets are written to `public/assets/`.

| What | Source | Licence | Used for | Ships in game? |
|---|---|---|---|---|
| MPFB 2.0.18 (MakeHuman for Blender) | extensions.blender.org/add-ons/mpfb | GPL-3.0-or-later | Authoring tool in Blender (generates human base meshes) | **No** (tool only) |
| MakeHuman system assets | files.makehumancommunity.org/asset_packs/makehuman_system_assets | CC0 | Base mesh, targets, eyes, brows, lashes, hair, teeth, tongue, clothes, rigs | Derived meshes/textures |
| MakeHuman skins01, skins02 | files.makehumancommunity.org/asset_packs/skins0{1,2} | CC0 | Photographic skin base-colour textures | Derived textures |
| MakeHuman faceunits01, visemes01, visemes02 | files.makehumancommunity.org/functional/ | CC0 (MakeHuman functional packs) | ARKit-style face units + viseme shape keys for facial animation / lip sync | Derived morph targets |
| Poly Haven textures / HDRIs / models | api.polyhaven.com, dl.polyhaven.org | CC0 | Photoscanned PBR materials, image-based lighting, props | Derived textures/models |
| ambientCG materials | ambientcg.com | CC0 | PBR materials | Derived textures |

Generated in-house (no third-party licence): pore detail-normal maps, roughness/stubble maps, hair-card textures, all animation, all code.

Fetch scripts: `tools/assets/fetch_makehuman.sh` (MPFB + packs), `tools/assets/polyhaven.py` (textures/HDRIs/models by id).
