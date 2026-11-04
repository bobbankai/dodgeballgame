# Emberfall — design

A third-person action game in three.js. Five chapters, played in order, about 50 minutes in total.

## Premise

The mountain country of Akari is kept alive by five sacred flames, the **Embers**. Each one burns in a
shrine and keeps back the **Hollowing**: the ash-sickness that burns people hollow, leaving shells of
cracked grey skin with embers glowing in the cracks. The Hollow obey the **Hollow King**, who was once
Lord Sōen, keeper of the first Ember. He means to put out all five and light a sixth, black flame in the
ruined capital. Only someone with *ember-blood*, a person who can light a flame with their bare hands,
can kindle it.

**Kaede** (19) is a swordswoman. She is apprenticed to the old smith and sword-master **Oren** in the
village of **Hinoka**. Her younger brother **Ren** (14) has ember-blood. Nobody knew this until the
night the Hollow came for him.

## Cast

| Who | Role | Model |
|---|---|---|
| Kaede | player; quiet, stubborn, protective of Ren | `kaede.glb` |
| Oren | her master; gruff, kind, dies in Chapter One | `oren.glb` (old man, smith's apron) |
| Ren | her brother; taken in Chapter One, possessed in Chapter Five | `ren.glb` (boy) |
| Hisame | shrine maiden of the Drowned Shrine; Hollowed by grief, freed, then a guide | `hisame.glb` (white haori, red hakama) |
| Mika | village elder; survives, appears again in the ending | `villager_old.glb` |
| Gorran the Ashen | Chapter One boss; brute with a war hammer | `hollow_brute.glb` (scaled, glow) |
| Frost Warden | Chapter Three boss; giant in ice-crusted armour | brute variant, blue glow |
| The Forgemother | Chapter Four boss; armoured smith of the Heart Forge | brute variant, molten glow |
| The Hollow King | final boss, two phases | `hollow_king.glb` |

## Chapters

Target length for each chapter: 9–11 minutes. That covers exploration, 6–8 fights, cutscenes and the
boss. Every chapter ends at a shrine where Kaede relights an Ember, and each relit Ember unlocks a new
Ember Art.

### 1. Cinders — Hinoka village, autumn dusk
1. **Waterfall shrine** (tutorial): Kaede is training above the village. She sees smoke below.
   Movement, camera, attack and dodge prompts.
2. **Terrace path**: maples, burning hay racks. First Hollow stragglers (two footmen). Prompts for block
   and lock-on.
3. **Lower village**: burning houses and fleeing villagers. Mika says Oren went to the shrine to guard
   Ren. Spearmen and footmen in the lanes. Prompt for parry.
4. **Bridge over the stream**: an ambush with a wraith. Checkpoint.
5. **Village square** (cutscene): Gorran drags Ren away. Oren, wounded, holds the shrine stair.
6. **Shrine stairs**: a wave fight up the lantern-lit steps under the torii.
7. **Boss — Gorran the Ashen**, in the shrine courtyard beside the Ember brazier. Phase 2 below half
   health: Gorran rages, with more slams and a charge.
8. **Ending** (cutscene): Oren, dying, gives Kaede his blade *Kagaribi*. She relights the Ember, and
   *Ember Whirl* unlocks. "The ash road runs north. Follow it, and bring him home."

### 2. The Drowned Shrine — cedar forest, night rain
Cedar forest road (spearmen ambush, wraiths in the mist) → flooded approach with torii standing in
shallow water → bell tower → **boss: Hisame of the Drowned Bell** (fast, evasive, water lunges). Once
freed, Hisame tells Kaede that the King took Ren over the Frostwake pass. *Rising Flame* unlocks.

### 3. Frostwake — mountain pass, blizzard
A climb through snowfields and dead trees → a frozen monastery → an avalanche gate → **boss: the Frost
Warden**. *Cinder Burst* unlocks.

### 4. The Heart Forge — inside the mountain
Lava channels and chain bridges, with Hollow smiths at the anvils. Kaede sees Ren in chains as he is
carried up the shaft. **Boss: the Forgemother.**

### 5. The Hollow Crown — the ruined capital, night
A burning bridge, the castle courtyards, then the keep. A duel against the possessed Ren: you break
his guard and must not kill him. Then **the Hollow King** in two phases. Ending: dawn, the five Embers
relit, Ren freed, and Hisame and Mika at the shrine. Credits.

## Systems used by every chapter
- `Level` scripts drive the beats: spawn waves, wait until they are defeated, set checkpoints, run
  cutscenes (`setCinematic`, `shot`, `say`) and set objectives.
- Each chapter's art: a terrain heightfield with splat layers, kit pieces (`assets/env/village/*`),
  instanced trees and rocks, weather (`Weather`, `G.uWetness`, `G.uSnow`), point lights for fires, and
  particle emitters.
- Music cues for each chapter: `explore`, `combat`, `boss`. The game crossfades between them by the
  number of aware enemies.
