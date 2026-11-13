# FRACTURED TIME — MASTER DEVELOPMENT DIRECTIVE (digest)

> A structured digest of the owner's original "Master Development Directive" (story, campaign, systems, architecture).
> Every concrete requirement is kept; prose is condensed. The word-for-word quality contract is `GRAPHICS_DIRECTIVE_PROMPT.md`.
> Where the two overlap, the stricter one wins. This is a full game production, not a prototype.

## Identity
- Title **FRACTURED TIME**. Cinematic sci-fi third-person (over-the-shoulder) action adventure.
- Three.js, **WebGPURenderer** primary, **WebGL2 fallback**, **TSL** node materials, Blender for models/rigs/animation,
  Rapier 3D physics, TypeScript, Vite. Desktop browsers primary; mobile secondary (adaptive graphics + touch controls).
- Campaign: **5 interconnected chapters**, target 60-90 min, minimum 45 min of meaningful gameplay.
- Quality references (never copy): Detroit: Become Human, Control, Cyberpunk 2077, Quantum Break, TLOU2; Sifu melee,
  Control supernatural action, God of War boss cinematics, Sekiro defensive timing, Quantum Break time abilities.
- Everything original: characters, locations, animation, dialogue, music, gameplay. No copyrighted assets or storylines.

## Story
2089. HELIX DYNAMICS' first full-scale Chronal Engine activation goes catastrophically wrong; time fractures: buildings shift
between historical states, people meet alternate selves, districts vanish and return.
- **Ethan Vale** (playable): ex-special-operations, volunteered for HELIX's Chronal Integration Program; wakes in the wrecked
  facility with fragmented memories; body synchronised to the Chronal Engine (local time manipulation). Distrustful, confused,
  regains memory, faces decisions about identity and responsibility.
- **Dr. Imani Reyes**: lead temporal physicist; guides Ethan; intelligent, resourceful, morally conflicted; knows more than she says;
  central emotional connection; her involvement in the original experiment is revealed in Ch.4.
- **Director Soren Voss**: HELIX director; publicly restoring reality; believes humanity's future needs control of time;
  secretly engineered the experiment to control alternate timelines.
- **The Echo**: alternate Ethan with more advanced temporal abilities; antagonist first; reveals the Engine's real purpose; allies in Ch.4.
- **Commander Nyx**: leader of HELIX temporal security; recurring rival; close-quarters expert; experimental temporal tech; personal
  link to Ethan's forgotten past.
- Every major character needs clear motivation, distinct personality, meaningful dialogue, development, unique visual design,
  facial expression/animation, and real story involvement.

## Campaign (each chapter: exploration + combat + environmental interaction + narrative + cutscenes + a meaningful end; never a bare arena)
1. **THE INCIDENT** (12-15 min) — HELIX Underground Research Facility. Escape the damaged complex; labs; first memory fragments;
   time-manipulation puzzles; malfunctioning security units; scripted temporal distortions; discover the Chronal Engine.
   Teaches: movement, sprint/jump, camera, light/heavy attacks, dodge, block, **perfect parry**, lock-on, **time slow**.
   Boss **SENTINEL A-07** (large experimental security machine): multiple telegraphed attacks, openings, stagger, **two phases**,
   cinematic phase transition. Ending: surface; city is a fractured mix of timelines; temporal storm; a figure resembling Ethan watches; cut to black.
2. **THE OTHER WORLD** (12-16 min) — Fractured Metropolitan District. Overlapping timelines (new/abandoned/overgrown/other eras).
   Meet Imani. Streets, buildings, rooftops, underground; HELIX forces; anomalies; multi-stage puzzles; civilian recordings;
   **cinematic pursuit**. Teaches: **time rewind**, advanced combos, environmental interaction, vertical traversal, better AI,
   dynamic hazards, timeline-dependent puzzles. Boss **RIFT MARSHAL** (temporal armour: accelerates, afterimages, recovers from
   attacks, counters repetition, changes patterns). Ending: footage shows Ethan entering the Engine before the disaster.
3. **THE DOPPELGANGER** (14-18 min) — Abandoned HELIX Corporate Arcology existing across timelines; interior shifts between realities.
   Infiltrate; labs; shifting interiors; temporal-synchronisation puzzles; **Project Palimpsest**; unlock **Temporal Echo**.
   Teaches: echo clones, enemy counterattacks, multi-stage platforming, timeline-switching puzzles. Boss **THE ECHO** (mirror-skilled:
   advanced counters, temporal clones, time slow, rapid movement, adaptive patterns). Revelation: HELIX meant to overwrite undesirable
   timelines; Voss planned to erase alternate futures; the Echo sabotaged it, which fractured reality. Ending: both Ethans share blame;
   Voss activates a second Chronal Engine; collapse accelerates.
4. **THE PARADOX** (14-18 min) — multiple interconnected timelines: pristine future city, ruined version, earlier HELIX lab,
   destabilising industrial facility; each with distinct lighting and environmental storytelling. Travel between timelines;
   advanced time puzzles; temporal enemies; recover memories; learn Imani's involvement; cinematic environment transformations;
   confront Nyx. Teaches: advanced timeline switching, **temporal counterattacks**, multi-stage combat, environmental state
   manipulation, cooperative story interactions with Imani. Boss **COMMANDER NYX** (3 phases: precise melee; temporal-enhanced;
   unstable arena with shifting states). Revelation: Ethan volunteered to prevent a predicted catastrophe; his memories were altered
   after he found the prediction manipulated; Voss engineered the crisis. Ending: Ethan will enter the Engine network; Imani warns
   restoring reality could erase timelines; the Echo returns to help.
5. **THE FINAL TIMELINE** (18-22 min) — The Temporal Nexus outside space-time; floating city fragments; overlapping timelines;
   breaking reality. Elite temporal enemies; the campaign's most complex puzzles; every ability used; large cinematic environmental
   transformations; fight beside the Echo; reach the central Engine. Final boss **DIRECTOR SOREN VOSS**, three substantially
   different phases: (1) Human Control: precise melee, defensive counters, temporal barriers, advanced movement; (2) Temporal
   Ascension: battlefield distortions, rapid phase changes, multiple temporal projections, interactive hazards; (3) Reality Collapse:
   continuously transforming arena, cinematic camera transitions, combined player abilities, a mastery test of combat + time systems.
   **Ending A** restore the original timeline (alternate realities vanish; Ethan accepts consequences). **Ending B** preserve the
   fractured worlds as separate realities (worlds survive; humanity adapts to multiple histories). Both need complete cinematics
   reflecting earlier discoveries and decisions.

## Graphics (see GRAPHICS_STANDARD.md for the contract)
WebGPURenderer + WebGL2 fallback, TSL node materials, RenderPipeline post, PBR, IBL, correct colour management, modern tone mapping;
verify every feature against the installed Three.js version; graceful fallbacks; no WebGL-only post with WebGPURenderer.
Lighting: PBR, IBL, high-quality soft directional shadows, atmospheric illumination, AO, SSGI where supported, indirect light,
volumetrics, emissive surfaces, reflection probes or alternatives. Post: SSR, SSGI, GTAO, TAA, bloom, DOF, motion blur, filmic tone mapping,
subtle chromatic aberration during temporal events, grain, grading, fog, distortion — each tuned, none excessive.
Temporal VFX: afterimages, trails, localized distortion, fragmented light, suspended + reversed particles, reconstruction effects,
timeline transitions, colour shifts, ripples, glowing fractures — all gameplay-driven, not decoration.

## Blender / assets (see MODELING_STANDARD.md)
Original rigged characters (Ethan, Echo, Imani, Voss, Nyx, bosses, standard + elite enemies); modular environment kits (labs, city
streets, skyscraper interiors, rooftops, subway, research, industrial, Temporal Nexus); GLB/glTF 2.0; naming conventions, scale,
material validation, texture packing, mesh optimisation, LODs, collision meshes, automated exports, validation scripts; test every
import in Three.js (a successful export does not prove materials/rigs/animations work).

## Animation (see ANIMATION_STANDARD.md)
Authored skeletal animation in Blender (not primitive rotation tweening): idle breathing/look-around, walk/run/sprint, starts/stops,
turns, strafe, jump/fall/land; multiple light + heavy attacks, finishers, block, perfect parry, counters, directional dodges,
stagger/hit reactions, recovery, contextual finishers; time-slow/rewind/echo/timeline-shift/temporal-counter/recovery; cinematic
(walk-while-talking, look at others, device interaction, emotional gestures, chapter-specific). State machines, blending, crossfades,
root motion, animation events, foot placement, facial animation. A visible attack must match its registered hit timing.

## Combat (see COMBAT_STANDARD.md) · Time (see GRAPHICS directive §19) · AI · Bosses
Light/heavy/combos, directional dodge, block, perfect parry, counters, lock-on + switching, stagger, guard break, recovery,
aerial/launcher follow-ups, environmental interactions, cinematic boss finishers. Consistent hitboxes, collision, damage, stamina/guard
resources, animation timing, recovery windows, interruptions, target priority, feedback. No faking combat by subtracting health.
Camera: smooth follow, adjustable distance, lock-on framing, collision avoidance, context framing, subtle shake, boss framing.
Time: **slow** (enemy anims/physics/hazards, audio processing, balanced cost), **rewind** (bounded snapshot history over fixed
timestep; restores player/enemy/combat/physics/effect state; protects checkpoints and story decisions), **echo** (records inputs/actions,
replays movement + compatible animations, triggers mechanisms, joins combat, expires), **timeline shift** (structured timeline states,
collision stays valid), **temporal counter** (perfect-timed defence opens a follow-up). Temporal energy/stability resource; no infinite
exploits; bosses stay hard without disabling learned abilities.
AI: behaviour trees / HFSM / utility. Patrol, detect, investigate, pursue, navigate, spacing, attack choice by distance/state,
defend, stagger recovery, react to abilities, return after combat. Archetypes: standard HELIX security, fast temporal operatives,
defensive armoured, elite close-combat, temporal anomalies, experimental machines, boss-only. Each has distinct visuals, animation
sets, behaviour, strengths/weaknesses, audio cues. Group combat: spacing, repositioning, coordinated openings, attack tokens.

## Cutscenes / narrative (see CINEMATICS_STANDARD.md)
Scripted character actions, camera tracks + blending, facial expressions, dialogue sequencing, subtitles, sound sync, lighting transitions,
environment animation, timeline events, triggers, clean return to gameplay; film language (establishing, close-ups, OTS, tracking, DOF,
blocking, dramatic light, pauses, ambient sound). No static text screens for revelations. Skippable once seen without breaking progression.
Bosses get introductions and endings.

## Level design / physics / UI / audio
Exploration (optional discoveries, research logs, narrative clues, terminals, doors/access, elevators, puzzles, traversal, secrets,
collectible story info); distinct identity per chapter; landmarks guide the player (not waypoint arrows); selective physics-assisted
destruction (glass, debris, machinery, collapses, temporal reconstruction). Rapier fixed-timestep physics: character collision,
grounding, gravity, slopes, stairs, moving platforms, dynamic objects, triggers, collision layers, hazards; optimised collision meshes.
UI: main menu (New Game, Continue, Chapter Select after unlock, Settings, Controls, Credits, Exit), HUD (health, temporal energy,
equipped ability, objectives, boss health, prompts, subtitles, optional target markers — minimal in exploration), pause (Resume,
Settings, Controls, Restart Checkpoint, Main Menu), settings (graphics presets, resolution scale, audio, mouse/camera sensitivity,
motion blur, subtitles, colour accessibility, key rebinding). Input: keyboard+mouse, gamepad, touch.
Audio: ambience, footsteps, movement, combat impacts, temporal sounds, machinery, UI, boss cues, cinematic transitions; dynamic layered
music (exploration, suspense, combat, boss, revelation, finale) with smooth transitions; full original dialogue with subtitles and
timing (do not pretend voice recordings exist); spatial audio where useful.

## Performance / architecture / save / QA
~60 FPS capable desktop, 30-60 lower-end; presets ULTRA / HIGH / BALANCED / PERFORMANCE; culling, LOD, instancing, texture + mesh
compression, batching, streaming, async loading, selective shadows, dynamic resolution, shader compile management, disposal, memory
monitoring; measure, never assume. TypeScript, modular, data-driven chapters, explicit state machines, central resource management,
rendering abstraction, consistent events, structured versioned saves (IndexedDB): chapter, checkpoint, health/abilities, unlocked
mechanics, decisions, objectives, collectibles, flags; rewind history must never corrupt saves. Suggested layout:
`public/assets/{characters,enemies,bosses,environments,animations,textures,audio,cinematics}`, `src/{core,rendering,gameplay,player,
combat,abilities,temporal,physics,animation,ai,bosses,world,chapters,cinematics,narrative,audio,ui,input,optimization,utils}`,
`blender/{characters,environments,rigs,animations,export-scripts}`, `tests`, `docs`.
QA: movement, jumping, collision, combat, blocking, parrying, AI, boss transitions, all temporal abilities, puzzles, checkpoints,
saves, chapter progression; visual inspection of characters/deformation/materials/lighting/shadows/reflections/effects/cutscenes/UI;
browsers: WebGPU start, WebGL2 fallback, loading, resize, pointer lock, audio init, fullscreen, errors, presets; automated tests where practical.
**A chapter is complete only when objectives, interactions, combat, cinematics, transitions and checkpoints all work together.**

## Production phases (milestones, not permission to drop later phases)
1 Technical foundation · 2 Character + animation foundation · 3 Advanced combat · 4 Temporal mechanics · 5 Enemy AI + boss framework ·
6 Graphics + environment production · 7 Cinematic + narrative infrastructure · 8 Chapters 1-3 · 9 Chapters 4-5 + endings ·
10 Audio, UI, progression · 11 Optimisation + testing · 12 Final polish.

## Non-negotiable restrictions
No small prototype passed off as finished; no single combat arena replacing the game; no cubes/capsules as final main characters;
no static poses in major cutscenes; no health-subtraction combat; no rewind that only restores visuals; no one-attack bosses; no
disconnected chapters; no claiming unimplemented features complete; no TODO-comment systems; no WebGL-only post on WebGPURenderer;
no ignoring animation quality or performance; no meaningless repeated props; no placeholder environments as final; no needless libraries;
no bulk low-quality code; no abandoning the storyline.

## Deliverable
A fully playable five-chapter campaign with the whole story, all characters, all environments, all cutscenes, a controller, advanced
melee, functional time mechanics, multiple enemy archetypes, all bosses, authored Blender animations, detailed models, WebGPU rendering
with WebGL2 fallback, complete UI, audio, saves/checkpoints, graphics presets, tested progression, **both endings**, build/run
instructions, asset attribution, architecture/controls/systems documentation, and an honest list of remaining limitations.
