# FRACTURED TIME

Cinematic third-person sci-fi action adventure. Three.js + **WebGPU** (WebGL2 fallback) + TSL, Rapier physics, TypeScript, Vite.
Models, rigs and animations are authored in **Blender 5.3** by Python scripts. Five-chapter campaign (the owner wants all five,
both endings, at maximum practical AAA-style quality). This folder is a self-contained project inside the Inkbound repo;
the Inkbound game in the repo root is unrelated.

## READ BEFORE YOU BUILD (mandatory, every session)

The owner's standing quality contract is in `docs/`. Read the ones that apply before implementing anything, and re-read when a task
gets long. Never silently downgrade a requirement; if one can't be met, say so and record it in `docs/PROJECT_PROGRESS.md`.

| Doc | Read when |
|---|---|
| `docs/GRAPHICS_DIRECTIVE_PROMPT.md` | **Always.** The owner's verbatim quality directive (26 sections). Source of truth. |
| `docs/MASTER_DEVELOPMENT_DIRECTIVE.md` | Story, characters, 5 chapters, bosses, systems, architecture, phases, restrictions |
| `docs/AAA_QUALITY_STANDARD.md` | Always: workflow, completion ladder, honesty rules |
| `docs/ART_DIRECTION.md` | Any visual work |
| `docs/GRAPHICS_STANDARD.md` | Rendering, lighting, materials, post, shaders, VFX |
| `docs/MODELING_STANDARD.md` | Any Blender model (characters, environments, props), textures, exports |
| `docs/ANIMATION_STANDARD.md` | Clips, rigs, state machines, cinematics performance |
| `docs/COMBAT_STANDARD.md` | Combat, AI, bosses, temporal abilities, camera/controller feel |
| `docs/CINEMATICS_STANDARD.md` | Cutscenes, story, dialogue, audio, UI |
| `docs/PERFORMANCE.md` | Budgets, optimisation, testing |
| `docs/PROJECT_PROGRESS.md` | Start and end of every session: what is truly done, what is not |

## Workflow for every major task
1. Review the applicable requirements. 2. Inspect the existing project. 3. Set the intended quality level.
4. Implement. 5. Test functionality. 6. **Look at the actual rendered result** (screenshots; never assume it looks good because the code runs).
7. Fix deficiencies. 8. Update `docs/PROJECT_PROGRESS.md`.
Status ladder per feature: Planned > Implemented > Integrated > Tested > Visually reviewed > Polished > Complete. Never claim Complete without evidence.
A chapter is complete only when objectives, interactions, combat, cinematics, transitions and checkpoints all work together.

## Run
- `npm install` then `npm run dev` (http://localhost:5180). `npm run build` = typecheck + production bundle. `npx tsc --noEmit` typechecks.
- Dev URL params: `?quality=ultra|high|balanced|performance`, `?webgl` (force the WebGL2 backend), `probe.html` and `bisect.html` (renderer test pages).
- **Headless screenshots** (`tools/shot.cjs`): WebGPU presentation needs a real compositor, so run headful under Xvfb:
  `NODE_PATH=/opt/node22/lib/node_modules xvfb-run -a -s "-screen 0 1400x900x24" node tools/shot.cjs "<url>" out.png webgpu 960 540 1500`.
  The mode `webgl` runs plain headless (WebGL2 backend). Do NOT add `--use-angle=swiftshader` for webgpu mode (it destroys the device).
  Software rendering is slow and timing is meaningless; judge looks and correctness, not frame rate.
- `tools/rawgpu.cjs`, `tools/rawcanvas.cjs`, `tools/destroy.cjs`: diagnostics for the headless WebGPU environment.

## Blender (5.3 at /opt/blender, headless)
- `blender -b --factory-startup --python-exit-code 1 -P blender/characters/ethan.py -- [--fast] [--preview out.png] [--poses dir [--clips a,b]] [--export]`
  `--fast` = coarse meshing + no AO (iteration only; never judge quality from it: it creates false defects). Workbench needs a GPU: use Cycles.
- `blender/common/sdf.py` (signed-distance sculpting, numpy) and `ftlib.py` (materials, rig, Poser, spline clips, GLB export) are vendored from the
  Inkbound toolkit. `blender/characters/humanoid.py` builds every human (shared 70-bone rig + A-pose) from a spec; `blender/animations/` holds the
  authoring DSL (`anim_lib.py`) and clips (`ethan_anims.py`). Exports go to `public/assets/`; clip events (hit windows, cancel, i-frames,
  striker bone, damage) are written to `public/assets/animations/humanoid_clips.json` and read by the combat system.
- Blender space is (x, y, z); character faces -Y, left = +X; glTF/three is (x, z, -y), so characters face +Z in the game.
- Rig conventions: pose rotations are about armature axes; +X bends an upward bone forward / swings a downward bone back; `ax` on feet = absolute pitch
  (+ = toes down); mirrored right side negates ry, rz, tx.

## Pipelines (v1)
- People: `blender/characters/person.py` builds any cast member from a spec (MPFB body + face targets, layered skin, eyes, hair shells,
  kit, 75 face shapes, baked skin, armour masks): `imani.py`, `nyx.py`, `voss.py` (Ethan still has his own `ethan.py` + `ethan_kit.py`).
  Export + pack: `tools/assets/export_character.sh <name>` (falls back to `helix.py --variant` for trooper/operative/heavy/marshal).
- Hard surface: `blender/common/hardpoly.py` (bevelled boxes, outline plates, bolts, rods, plane cuts, exact booleans, weighted normals);
  SDF (`sdf.py`) only for organic/round forms. `blender/common/masks.py` bakes AO + edge masks on a UV atlas for armour recipes.
- Levels: `blender/environments/ch1_level.py`, `ch2_level.py` (`--only s3,s4 --probes --export`; `--render KEY out.png` = Cycles preview).
  Probes (baked SH light for characters) MUST run before export (export joins objects and strips textures). Scanned sets ship their AO
  map (`tools/assets/ship_ao.py` regenerates `src/rendering/aosets.ts`). City pieces: `citykit.py`, facade sets `facades.py`.
- Voices: `python3 tools/voices/record.py` records every `['WHO', 'line']` in `src/chapters/*.ts` with Kokoro (model in vendor/kokoro);
  unchanged lines are skipped. Sound recipes are checked offline in `audio.html` (peak / RMS / length per recipe).
- Chapters: `?chapter=N&at=<beat>` (ch1: wake, corridor, checkpoint, lab, servers, engine, lift, surface; ch2: rooftops, street, cafe,
  gate, plaza, pursuit, marshal); `&fast` in tests shortens dialogue. No params = title screen. `lab.html?char=|path=&view=&echo`.

## Engine facts verified against three 0.187 (do not rely on memory of older versions)
- Import renderer/materials from `three/webgpu`, node builders from `three/tsl`, effect nodes from `three/addons/tsl/display/*`
  (`ao`=GTAO, `ssgi`, `ssr`, `bloom`, `dof`, `chromaticAberration`, `film`, `smaa`, `fxaa`, `taau`, `motionBlur`). `RenderPipeline` replaces `PostProcessing`.
  `PCFSoftShadowMap` no longer exists (falls back to PCFShadowMap). `bloom` is NOT exported by `three/tsl`.
- In TSL, **never use JS arithmetic on nodes** (`1 - node` is NaN in the WGSL). Use `.oneMinus()`, `.sub()`, `.mul()`. TSL modules are cast to `any` (static types too strict).
- `chromaticAberration` needs an explicit centre (`vec2(0.5,0.5)`); `GTAO`/`SSGI` sample raw view-space normals from an MRT `normal: normalView`.
- Skinned materials: use `positionGeometry` (rest pose) for surface patterns that must stick to the body.

## Conventions
- `src/` layout follows the master directive (core, rendering, physics, input, animation, player, combat, temporal, ai, world, chapters, cinematics, audio, ui).
- Fixed 60 Hz simulation (`src/core/loop.ts`); time manipulation scales per-group `dt` (`timeScale.player` / `.world`), never the tick rate.
- Systems talk through the typed event bus in `src/core/events.ts`.
- Keep files focused; no TODO-comment systems; no placeholder assets presented as final.
- Third-party skills for this project live in the repo-level `.claude/skills/` (three.js, shaders, Blender, colour, game feel). Use them.
