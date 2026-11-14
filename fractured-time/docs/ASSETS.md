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
| Kokoro-82M v1.0 (ONNX, via kokoro-onnx; model + voice styles from github.com/thewh1teagle/kokoro-onnx releases) | huggingface.co/hexgrad/Kokoro-82M | Apache-2.0 | Neural text-to-speech for every line of dialogue (`tools/voices/record.py`) | Generated voice recordings only (the model does not ship) |
| CMU Graphics Lab Motion Capture Database, BVH conversion by B. Hahne (cgspeed), mirrored at github.com/una-dinosauria/cmu-mocap | mocap.cs.cmu.edu | Free for any use, including commercial products; may not be resold as raw data (READMEFIRST.txt) | Locomotion, idles, gestures, jump, roll, run start, death (retargeted by `blender/animations/mocap.py`) | Retargeted clips in `animations/humanoid.glb` |

Poly Haven sets used in the city (CC0): concrete_tile_facade, rectangular_facade_tiles_02, brick_4, red_brick_plaster_patch_02, asphalt_02,
green_metal_rust, corrugated_iron, brick_moss_001, brushed_concrete_03, metal_grate_rusty; HDRI approaching_storm (sky of the surface).

Generated in-house (no third-party licence): facade window sets (`blender/environments/facades.py`), every synthesised sound effect,
ambience and the score (`src/audio/`), pore detail-normal maps, roughness/stubble maps, hair-card textures, every authored animation
(strikes, guard/block/parry, dodges, reactions, chronal casts), all code. Clip sources are listed per clip in `humanoid_clips.json`.
The motion data used was captured at CMU with funding from NSF EIA-0196217.

Fetch scripts: `tools/assets/fetch_makehuman.sh` (MPFB + packs), `tools/assets/polyhaven.py` (textures/HDRIs/models by id).
