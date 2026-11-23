# VOWBREAKER — design

A story-driven 3D arena fighter in Babylon.js (WebGPU), in the cursed-sorcery genre that Jujutsu Kaisen
made popular: curses born from human grief, sorcerers who bind them, techniques, domains, vows. The world,
cast, techniques and story are our own. Target length: about 50 minutes from the title screen to the credits
(eleven chapters, fourteen fights, every chapter opening and closing on cutscenes).

## Look

Stylized, anime-cinematic, not photoreal. References studied: Guilty Gear Xrd/Strive (inverted-hull ink
outlines, artist-controlled cel thresholds, limited animation, bold red/black/white graphic design),
Genshin Impact (SDF face shadows, soft aerial perspective), Hi-Fi Rush (thick ink, comic starbursts),
Zenless Zone Zero (desaturation and radial blur on big moves), Persona 5 (slanted graphic UI).

* Characters: cel-shaded with two-step ramps, a cool shadow tint, a warm terminator, painted AO thresholds
  (vertex colour), face shadows from a head-space SDF, Kajiya-Kay hair highlights with an "angel ring",
  rim light, inverted-hull ink outlines whose width is constant in screen space and tapers by vertex colour.
* Animation runs on 2s/3s (12–20 fps stepped poses) while the game runs at full rate, like TV anime;
  hitstop, smears and impact frames sell the hits.
* Environments: hand-made blocks from Blender, painted by vertex colour; procedural patterns (bricks,
  tiles, planks, shoji) and world-space wash and hatching in the shader; wet streets, neon, lanterns.
* Post: HDR, GTAO-style ambient occlusion as a cool wash, screen-space ink edges from depth and normals,
  bloom (13-tap down / tent up), bokeh depth of field in cutscenes, radial and camera motion blur,
  god rays, chromatic aberration, grain, vignette, grading and a filmic shoulder.
* Anime FX: black-and-white impact frames, speed lines, manga screen tones, ink-wipe transitions,
  flashback paper grading (monochrome with one colour kept), domain unveilings that repaint the world.
* GPU particles simulated in WebGPU compute shaders (curl noise, drag, ground collision).

## World

When people grieve, fear or regret, what they cannot let go of seeps out as **cursed energy** and pools
into **curses**. Sorcerers of **Hakuro Academy** (hidden in the hills west of Tokyo) hunt them. A sorcerer
fights with a **technique** they were born with and, at their peak, can **unveil a domain**: the world
inside their heart, laid over the world outside, where their technique cannot miss. Sorcerers make
**vows**: promises that bind them and give power for what they give up.

## Cast

| Who | Age | Technique | Domain |
|---|---|---|---|
| **Itsuki Kagari** (player) | 17 | *Hollow Bell*: strikes leave a ringing seal; a second hit tolls it | Temple of the Unrung Bell |
| **Sayo Tachibana** | 18 | *Thousand Folds*: talismans fold into cranes, wolves and a paper blade | Garden of Folded Prayers |
| **Genjirō Mikami** (teacher) | 44 | *Stillwater*: time pools around him | Mirror Lake of Ten Thousand Moons |
| **Sōjin Amagiri**, the Lantern Monk | 46 | *Hundred Night Lanterns*: curses kept in lanterns | Night Parade Without End |
| **Ryōga Hoshino** (rival) | 17 | *Gravebrand*: marks that crush with weight | — |
| Mio Kagari | 9 | Itsuki's little sister; died three years ago | |
| Hina Amagiri | 6 | Sōjin's daughter; died twenty years ago | |
| Kōta Tachibana | 8 | Sayo's twin; given to the clan's curse | |

Curses: **Mudhands** (crawling grunts), **Lantern Wisps**, **Red Umbrella**, **the Weeping Bride**,
**Shiragami** (the Tachibana clan's paper god), **the Little Bell** (Itsuki's own curse).

### Backstories

* **Itsuki** was meant to collect Mio from cram school on a rainy night three years ago. He stayed out with
  friends. She walked home alone, let herself in, and waited for him. A curse set the building alight. The
  last thing the neighbours heard was the little bell on her school bag. Since then Itsuki hears a bell
  when curses are near; his technique is that bell. His guilt has grown into a curse of its own.
* **Sōjin** was the sorcerer of Amagiri, a village in the mountains. Twenty years ago, on the night of the
  lantern festival, a swarm of curses came. He sent for help. The Academy's council refused: the village
  had defied a clan. His partner Genjirō Mikami was ordered to stay put, and did. Sōjin's wife and his
  daughter Hina died. Hina's last words: "Papa, the lanterns are pretty." Sōjin swallowed the curse that
  killed them and learned to keep curses in lanterns. Now he means to perform the **Grand Vow** on the
  night of Tokyo's lantern festival: bind every grief in the city into one god-curse, with himself as its
  master, and end the council that let his family burn.
* **Mikami** has never forgiven himself for staying put. He gives his life so the students can escape.
* **Sayo**'s twin brother Kōta was born without cursed energy. When they were eight the clan elders gave him
  to Shiragami, the paper god that guards the clan, as the price of a vow. She kept the crane he folded her.
* **Ryōga** was saved from a curse by Sōjin at seven and raised by him. He learns that Sōjin means him to
  be the vessel of the Grand Vow.

## Chapters (about 50 minutes)

| # | Chapter | Play as | Fights | Place |
|---|---|---|---|---|
| P | The Bell That Didn't Ring | Itsuki | Mudhands (tutorial), Red Umbrella | Shiomi back alley, rain, night |
| 1 | Hakuro | Itsuki | Sayo (sparring) | Academy courtyard, dawn |
| 2 | The Weeping Bride | Itsuki | Wisps and Mudhands, the Weeping Bride | Seaside chapel ruins, moonlight |
| 3 | Underpass | Itsuki | Ryōga | Subway platform, night |
| 4 | Hina *(twenty years ago)* | young Sōjin | the curse swarm (cannot be won) | Amagiri village, festival night |
| 5 | Stillwater | Mikami | Red Umbrella, then Sōjin | Academy courtyard, rain at night |
| 6 | Thousand Folds | Sayo | paper retainers, Shiragami | Tachibana estate |
| 7 | Mio | Itsuki | the Little Bell | Burning apartment (memory) |
| 8 | Gravebrand | Itsuki | festival curses, Ryōga | Shinjuku crossing, red sky |
| 9 | Vowbreaker | Itsuki | Sōjin (two phases, domain clash) | Ritual tower / Night Parade |
| E | Spring | — | — | Hillside graves, cherry blossom |

## Combat

Arena fighter, one-on-one (some fights against groups). The camera frames both fighters; the player moves
freely in 3D relative to the opponent (lock-on).

* **Light** (J) string of four; **Heavy** (K) launches; light then heavy in a tight window is a
  **Black Spark** (2.5× damage, black-red lightning, impact frame, refills energy).
* **Techniques** (U / I / O): three per fighter, cost cursed energy.
* **Guard** (L, hold): blocks, chips; perfect guard (just before the hit) staggers the attacker.
* **Dash** (Space): fast step with brief invulnerability; double tap to close distance.
* **Jump** (Shift) for air strings.
* **Domain** (P) at full domain gauge: cinematic unveiling; for 12 s the world is the domain, your hits
  cannot be guarded and your techniques cost nothing. Two domains at once clash (mash to win).
* **Vow** (Y) once per fight below 30% health: double damage, no guard, for 15 s.
* Hitstop scales with damage; hitstun, juggles with gravity scaling, combo damage scaling.

## Code

* `vowbreaker/src/shaders` WGSL: `lib/` (include library), `materials/`, `post/`, `compute/`.
* `vowbreaker/src/render` the pipeline in TypeScript.
* `vowbreaker/src/game` fighters, combat, AI, camera, input.
* `vowbreaker/src/story` director, dialogue, the chapters.
* `vowbreaker/tools/blender` characters, rig, animation library, stages (headless Blender), all on
  Vowbreaker's own modelling code: `vbcore.py` (scene, vertex data, Cycles AO bake, export),
  `vbmesh.py` (a ring-loft modeller: rotation-minimising frames, superellipse/lens/pleat profiles,
  quad grids smoothed with Catmull-Clark, decals cast onto surfaces), `vbchar.py` (parametric anime
  heads, polar-mesh eyes, skull-hugging hair locks, lofted clothing, hands, shoes, rig, weights),
  `vbcast.py` (the fourteen character specs), `vbanim.py` + `anims.py` (pose library keyed with a
  shape-preserving cubic), `stages.py`.

## Testing headless

The container has no GPU: tests run Chromium's WebGPU on SwiftShader (software Vulkan), about ten
seconds a frame at 960x540. Chrome's GPU watchdog kills a GPU process that stalls that long, which
showed up as random "Target crashed" errors; the tools pass `--disable-gpu-watchdog`.

* `node tools/play.mjs '<url>?test&duel=itsuki,sayo&stage=academy' <outDir> '<steps json>'` steps the
  game deterministically and takes screenshots (`{t, eval, render, shot}`; `eval` runs before the step).
  Fights start after an intro whose length depends on real time: poll `!!__game.director.fight`.
* `node tools/storyrun.mjs '<url>?test&auto' <outDir> [maxGameSeconds] [fromChapter]` plays the whole
  story (a stand-in AI fights for the player), screenshots every 20 s of game time, logs each fight's
  and chapter's length and every page error, and restarts at the current chapter if the browser dies.
  Run it against a production build (`npx vite build --outDir <dir>`, served statically).
  `?auto=fair` plays at a person's pace (normal-strength fights, lines held long enough to read):
  that is the run that measures the story's length.
