# Eclipse: Fallen Gods

A third-person fantasy action game that runs in the browser (Babylon.js, WebGPU with a WebGL 2 fallback).
You are Kael, the Vessel, carrying four dying sparks across five broken kingdoms to the god who stole the sun.
Five chapters, five gods; the whole story plays from the title screen to the credits.

| Chapter | Region | God |
|---|---|---|
| 1 | The Ashen Kingdom | Ignaroth, God of Flame |
| 2 | The Drowned Empire | Thaloryn, God of the Deep |
| 3 | The Shattered Sky | Vaeltris, God of Storms |
| 4 | The Forgotten Sanctuary | Sylvaris, God of the Wild |
| 5 | The Eternal Eclipse | Aurelion, God of the Sun |

## Play

Needs a recent Chromium-based browser for WebGPU (Chrome, Edge); Firefox and Safari fall back to WebGL 2.

```
npm install
npm run eclipse            # dev server, open the printed URL (title screen)
npm run eclipse:build      # production bundle into dist-eclipse/
npx vite preview --config eclipse/vite.config.ts     # serve that bundle
```

The first load fetches about 290 MB of models, textures, music and voices; later loads come from the cache.
Progress saves at every checkpoint (browser storage): *Continue* on the title screen resumes it, and finished
chapters unlock in *Chapters*.

## On your phone

Any recent phone works (Android Chrome and iPhone Safari 26+ support WebGPU; others use the WebGL 2 fallback).
The first load downloads about 290 MB, so use Wi-Fi. Hold the phone sideways.

- **A web address** (once the repo's Pages site is published, see below): open
  `https://<owner>.github.io/<repo>/eclipse/` on the phone. Then **Add to Home Screen** (iPhone: Share >
  Add to Home Screen; Android: the browser menu > Install app / Add to Home screen): it opens full screen and
  sideways, like an app, with its own icon.
- **From your computer, same Wi-Fi:** run `npm run eclipse`, and open the *Network* address it prints
  (for example `http://192.168.1.20:5180`) in the phone's browser. That address is plain `http`, which browsers
  do not treat as secure, so the phone uses WebGL 2 rather than WebGPU: it looks the same, a little slower.

Publishing: `.github/workflows/pages.yml` builds the repo's other game and Eclipse and publishes both, Eclipse
under `/eclipse/`. It runs on pushes to the default branch (or "Run workflow" in the Actions tab), and Pages
must be set to deploy from GitHub Actions (Settings > Pages). Eclipse has to be on that branch to be published.

## Controls

| | Keyboard and mouse | Gamepad | Touch |
|---|---|---|---|
| Move | `W A S D` / arrows | left stick | drag anywhere on the left |
| Look | mouse | right stick | drag on the right |
| Light attack | left click / `J` | RB | Strike |
| Heavy attack | right click / `K` | RT | Heavy |
| Dodge (brief invulnerability) | `Space` | B | Dodge |
| Block / parry (tap just before a hit) | `Q` / `L` | LB | Guard |
| Jump | `F` | A | Jump |
| Sprint | `Shift` | L3 | push the stick to its edge |
| Lock on | middle click / `Tab` | R3 | Lock |
| Interact | `E` | X | (not used in the story yet) |
| Flask (heal) | `H` | Y | Flask |
| Abilities | `1` `2` `3` `4` | d-pad | the diamonds at bottom centre (one appears per spark you earn) |
| Ultimate | `R` | LT | the last diamond |
| Pause, skills, journal, map, inventory | `Esc`, `Y`, `N`, `M`, `I` | | pause button |

Keys and mouse buttons can be rebound in Settings > Controls (from the title screen or the pause menu). Touch controls appear on touch devices (or add `?touch`). Play with the phone held sideways: upright, the game pauses behind a "turn your device" note. Hits vibrate the phone (Settings turns this off), and Settings > Fullscreen hides the browser bar.

## Combat in one paragraph

Enemies telegraph their strikes with a flash on the weapon. A red flash marks a strike you cannot parry: dodge it
(a dodge gives a brief window where nothing can hurt you). A plain glint can be parried: block just before it lands
to turn it aside, break the enemy's poise and open an execution. Some attacks (sun rays, flares, novas) cannot be
blocked at all. The gods change their fight at each health threshold, call reinforcements and mark the ground
before a strike lands: the glowing sigils are where it will hit. Every god you fell grants a spark (a new
ability) and two skill points to spend in the skill tree (`Y`); skill points also come from levelling.

## Quality and options

Settings are in the pause menu and remembered. Presets: `low` (phones), `medium`, `high`, `ultra`. Add
`?quality=low|medium|high|ultra` to override once. Adaptive resolution keeps the frame rate steady.
Contact shadows, the local light probe, volumetric fog, depth of field and TAA scale with the preset
(see `docs/RENDERING.md`).

## Developer shortcuts (URL parameters)

| | |
|---|---|
| `?level=ashen\|drowned\|sky\|forest\|eclipse` | jump into a chapter (`&at=<checkpoint>`, `&nointro`) |
| `?level=playground&boss=<id>` / `&enemies=a,b` | a bare arena with any god or enemies, for fight tests |
| `?level=kitview&kit=<name>` | lay an environment kit out with the game's materials |
| `?test` | deterministic stepping and `window.__game`, for `tools/play.mjs` |
| `?gl=webgl2` | force the WebGL 2 backend |

Headless testing: `node eclipse/tools/play.mjs "<url>/?test&level=sky" outDir @script.json 960 540` steps the game
on a fixed clock and takes screenshots (software rendering, so timings mean nothing). Asset pipeline and rendering
notes: `docs/DEVLOG.md`, `docs/RENDERING.md`, `tools/blender/`.

## Credits

Built from scratch in code: TypeScript, Babylon.js, Blender (Python), and numpy for the synthesised score and
effects; voices by the Kokoro model. Photoscans and textures are CC0 from Poly Haven; the base human is MakeHuman (CC0
targets).
