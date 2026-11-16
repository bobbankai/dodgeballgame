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
| Ocean and interior-mapping kits (`ocean.tsl.js`, `planar-reflection.js`, `windowMaterial.tsl.js`) from the ocean-water and interior-mapping skills | github.com/wolffe/three.js-skills (© 2026 Ciprian Popescu) | MIT | The open sea (Chapter 4), rooms behind every tower window | Yes: vendored source in `src/rendering/ocean/`, `src/rendering/windows/`, the MIT notice in a LICENSE file beside each |
| CMU Graphics Lab Motion Capture Database, BVH conversion by B. Hahne (cgspeed), mirrored at github.com/una-dinosauria/cmu-mocap | mocap.cs.cmu.edu | Free for any use, including commercial products; may not be resold as raw data (READMEFIRST.txt) | Locomotion, idles, gestures, jump, roll, run start, death (retargeted by `blender/animations/mocap.py`) | Retargeted clips in `animations/humanoid.glb` |

Poly Haven sets used in the city (CC0): concrete_tile_facade, rectangular_facade_tiles_02, brick_4, red_brick_plaster_patch_02, asphalt_02,
green_metal_rust, corrugated_iron, brick_moss_001, brushed_concrete_03, metal_grate_rusty, cobblestone_square (the plaza's setts; its
displacement map drives parallax occlusion), cobblestone_floor_001 (downloaded, unused); HDRI approaching_storm (sky of the surface,
dimmed to nightfall).

Poly Haven models (CC0), converted by `blender/props/foliage.py` or imported by `envkit.prop`:
- foliage (pine_forest and smugglers_cove sets): fir_tree_01, pine_tree_01, pine_sapling_medium, tree_small_02, fern_02, grass_medium_01,
  grass_medium_02, moss_01, shrub_02, shrub_04, nettle_plant, weed_plant_02, dead_tree_trunk, tree_stump_01, pine_roots, dry_branches_medium_01;
- rocks: rock_moss_set_01, rock_moss_set_02, boulder_01, rock_face_01, coast_rocks_01, coast_rocks_02, coast_land_rocks_02;
- street (hidden_alley set): exterior_aircon_unit, fire_hydrant, metal_trash_can, concrete_road_barrier_02, covered_car, old_tyre,
  barrel_stove, security_camera_01, utility_box_01/02, water_manhole_cover, rollershutter_door, rollershutter_window_01,
  modular_airduct_circular_01, modular_street_seating, street_lamp_01/02 (downloaded; the last four are not placed yet).
Poly Haven textures added for the forests and ruins (CC0): forest_floor, forrest_ground_01, mossy_rock, concrete_moss, distressed_painted_planks;
HDRI kloofendal_48d_partly_cloudy_puresky (daylight skies of Chapters 4 and 5).

Built in code (no third-party licence): the HELIX van (`blender/environments/vehicles.py`), bollards, chains and paper lanterns
(`streetkit.py`), the twig-cluster atlases rendered from the Poly Haven trees' own geometry.

Generated in-house (no third-party licence): facade window sets (`blender/environments/facades.py`), every synthesised sound effect,
ambience and the score (`src/audio/`), pore detail-normal maps, roughness/stubble maps, hair-card textures, every authored animation
(strikes, guard/block/parry, dodges, reactions, chronal casts), all code. Clip sources are listed per clip in `humanoid_clips.json`.
The motion data used was captured at CMU with funding from NSF EIA-0196217.

Fetch scripts: `tools/assets/fetch_makehuman.sh` (MPFB + packs), `tools/assets/polyhaven.py` (textures/HDRIs/models by id).
