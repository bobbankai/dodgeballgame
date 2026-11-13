# Eclipse: Fallen Gods — design

A third-person cinematic action RPG in Babylon.js (WebGPU, WebGL 2 fallback). Five chapters, played
in order, each ending in a god fight. Target length: 45–60 minutes for a first playthrough.

## World and premise

**Aetheris** was guarded by five gods, the **Pentarchs**: Ignaroth (flame), Thaloryn (tides),
Vaeltris (storms), Sylvaris (life) and Aurelion (light). Twelve years ago a black moon slid across the
sun and stayed there. People call it the **Eternal Eclipse**. Since then the gods have gone mad. Their
power has torn their kingdoms apart. The Ashen Kingdom burns under falling ash. The Drowned Empire sank
beneath a tide that never went out. The Shattered Sky broke into floating ruins. The Forgotten
Sanctuary grew into a forest that eats its own temples.

**Kael** (34) was a knight of the **Dawn Vigil**, Aurelion's order. He survived the night the Vigil's
citadel fell, but a sliver of divine light lodged under his breastbone. That makes him a **Vessel**:
someone who can take the *godspark* out of a god and keep it. No Vessel has lived for a thousand years.

What nobody alive remembers: the Pentarchs were never born gods. They were the first five Vessels.
They took the light of a dying star, and they became what they took.

## The truth (revealed over the chapters)

The sun is dying. Aurelion, the eldest, saw it first. He did not let the world end slowly. He pulled
the black moon across the sun and began to drink its last light, so that he could become the next sun
himself. To do that he needs every godspark. Starved of light, the other four gods went mad, and the
madness is what the world calls the corruption. Kael's journey has been steered from the start. The
voice that guides him belongs to **Ithra**. She was the Vigil's oracle and died the night the citadel
fell. She has been receiving "visions" from a god she still serves, and she sincerely believes she is
leading Kael to *free* Aurelion. In fact every spark Kael takes is a spark he is carrying home to
Aurelion.

## Cast

| Who | Role | Asset |
|---|---|---|
| **Kael** | Player. A former Dawn Vigil knight: dry, guarded, loyal to the dead. Layered, battered plate over leather and wool, a torn Vigil tabard and half-cloak, and a lantern-reliquary on his belt. Sword: *Oathkeeper*. | `kael.glb` |
| **Ithra** | A voice in the reliquary lantern who appears in visions as a translucent, hooded figure of light. Warm, certain, then broken by the truth. In the end she gives up what is left of her to free the sparks. | `ithra.glb` |
| **Mira Ashvale** | Smith of the Last Lantern refugee camp. She upgrades Kael's gear. Practical and funny. Her brother served under Kael. | `mira.glb` |
| **Brannoc** | An old lorekeeper at the camp. He reads the murals Kael finds and gives each chapter its history. | `brannoc.glb` |
| **Ignaroth** | God of Flame. A 7 m obsidian-armoured titan with molten seams and a crown of horns, wielding a burning greatsword. Proud, and in pain. | `ignaroth.glb` |
| **Thaloryn** | God of Tides. The torso of a sea-king on a long serpent coil, with a coral crown and a trident. Grieving and drowned. | `thaloryn.glb` |
| **Vaeltris** | Goddess of Storms. A winged, armoured storm-angel with a glaive. She tries to *warn* Kael before she breaks. | `vaeltris.glb` |
| **Sylvaris** | God of Life. An antlered dryad colossus whose lower body is a root mass, and the oldest. He tells Kael the sun is dying. | `sylvaris.glb` |
| **Aurelion** | God of Light. A radiant knight-god with a halo and wings of blades. The architect of the Eclipse. | `aurelion.glb` |

## Chapters

Each chapter runs about 9–13 minutes: exploration and secrets, 4–7 fights, one traversal or puzzle
set piece, a boss with 2–3 phases, and cinematics. Between chapters a short interlude at the **Last
Lantern** camp lets the player upgrade gear with Mira, hear Brannoc's lore and pick up new skills.

### I. The Ashen Kingdom — Ignaroth, God of Flame
Ash falls from a bruised orange sky over the collapsed castle-town of **Varn Keld**.
1. *Opening cinematic*: the Eclipse and the fall of the Vigil, told in flashes. Kael wakes in ash, and
   Ithra's lantern flickers on.
2. **Cinder Road** (tutorial): movement, camera, light and heavy attacks, dodge and block. Ash Husks
   shuffle out of the smoke.
3. **The Burned Village**: houses on fire and a ruined chapel. Parry is taught here, along with lock-on
   and the first Ember Brute. Optional: the cellar beneath the chapel (lore mural: *the five who took
   the light*).
4. **The Collapsed Gate**: a fight on the ramparts against archers and hounds, then a drop into the
   **Undercroft**. Its ruins glow with veins of lava, and there is a lever puzzle to open the floodgate
   of ash.
5. **The Crucible Throne** (boss): Ignaroth. Phase 1 is greatsword sweeps, overhead slams and fire
   waves. Phase 2 cracks the arena, adds meteor rain and lava fissures, and opens him to parries.
   Phase 3 sinks the floor into rising lava and drives Kael onto the rubble islands.
6. *Ending*: dying, Ignaroth whispers, "You carry his light… the Eclipse was a hand closing." Kael
   takes the flame spark and learns **Cinder Arc** and **Ember Burst**.

### II. The Drowned Empire — Thaloryn, God of Tides
Rain falls on a sunken imperial city: flooded colonnades, waterfalls spilling from aqueducts, and
temples half under the tide.
- Wading streets, Drowned Reavers (spear lunges) and Tidecallers (casters who shield their allies).
- **The Sunken Archive**: Brannoc's lore is found here. Murals show that the gods were mortal once.
- Set piece: the **Lock of Tides**. Valves lower the water to open the descent.
- Boss: **Thaloryn** in the flooded amphitheatre. He thrusts his trident, sweeps with his tail, sends
  tidal waves to jump or dash through, and in phase 2 summons whirlpools and submerges.
- Reward: **Riptide Dash**, a water dash that passes through attacks and crosses gaps, and **Tidal
  Ward**.

### III. The Shattered Sky — Vaeltris, Goddess of Storms
Mountains torn loose. Bridges and monasteries drift in a lightning storm above the clouds.
- Wind-bent grass, rope bridges, chain lifts, Storm Harpies diving from above, and Gale Knights.
- Set piece: crossing the **Broken Span** while lightning strikes the floating stones.
- Boss: **Vaeltris** on a floating dais. She makes dive strikes and calls lightning on marked circles.
  Wind gusts push Kael. In phase 2 she takes to the air, with tornado walls and chained bolts.
  Before the fight she tries to warn Kael: "Every spark you take, you carry to *him*."
- Reward: **Thunderfall**, a leap with a lightning slam, and **Gale Step**, an air dash and double jump.

### IV. The Forgotten Sanctuary — Sylvaris, God of Life
Giant trees, bioluminescent fungi and an overgrown temple-city with ancient chambers under the roots.
- Thornspawn ambushers, Rootbound Brutes and spore wisps. The paths are lit by glowing flora.
- Set piece: the **Heartroot Chambers**. Light pollen reveals hidden walkways.
- Boss: **Sylvaris**, rooted in the temple's heart. Vine lashes and root eruptions, summoned thornspawn,
  spore clouds and healing pods that Kael must burn with flame. Sylvaris tells Kael the sun is dying
  and that Aurelion means to become it. Ithra refuses to believe it.
- Reward: **Verdant Bloom**, a heal that also roots nearby foes, and **Thorn Lash**, a vine pull.

### V. The Eternal Eclipse — Aurelion, God of Light
The Vigil's citadel, lifted into the sky between light and darkness: white marble, gold, floating
stairs and a sky that turns as Kael climbs.
- Eclipse Sentinels (parry-heavy radiant knights) and Void Wraiths (they teleport).
- The revelation: Ithra hears Aurelion's true voice and understands what she has done.
- Final boss: **Aurelion**.
  - Phase 1 is a duel of sword, shield and radiant spears, and parries matter.
  - Phase 2: he uses the stolen sparks, so flame waves, tidal rings, lightning circles and thorn
    fields come back as attacks, and Kael answers with the power that counters each one.
  - Phase 3, the Eclipse: the arena goes dark. Ithra breaks Aurelion's hold, sacrifices herself and
    lends Kael **Dawnbreaker**.
- Ending: Kael gives the gathered light back to the sun. The black moon cracks, and the first dawn in
  twelve years rises over the Last Lantern. Kael's Vessel light is gone; he is only a man now. Credits.

## Combat

- **Light attacks**: a 4-hit combo with branch timing, and a sprint attack.
- **Heavy attacks**: a 2-hit chain. Holding charges the attack (it gains armour and breaks poise).
- **Dodge**: a short sidestep or a roll. I-frames last about 0.18 s for the dodge and 0.3 s for the
  roll. A perfect dodge slows time briefly.
- **Block and parry**: holding block takes stamina damage. Tapping it within 0.15 s of an impact parries,
  and a parry staggers the attacker and opens a **riposte**.
- **Poise and stagger**: every enemy has poise. Breaking it staggers them and offers an **Execution**
  (a context finisher).
- **Aerial**: a jump attack and a plunging attack (with Gale Step, more air options).
- **Divine abilities**: two per god, unlocked in order. They cost Aether, which is regained by hitting,
  parrying and executing. The ultimate is **Dawnbreaker**, used in the final fight.
- **Lock-on**: target switching, combat framing and a boss camera.
- **Hit feedback**: hit-stop scaled by weight, camera impulses, blood/ember/splash VFX by material,
  layered SFX and reaction animations by direction and weight.

## Progression

XP comes from kills, discoveries and bosses. Levelling gives skill points for three trees:
- **Blade**: combo extensions, heavy charge, riposte damage and execution.
- **Vessel**: Aether capacity, ability upgrades and spark passives.
- **Guardian**: health, stamina, poise and the parry window.

Equipment covers a sword, armour and a relic, upgraded by Mira with materials found in the world.
Collectibles: lore murals (Brannoc), Vigil relics (stat charms), and **Ember Flasks**, which are
healing charges and upgrades.

## Presentation

Cinematics are camera rails and cuts that drive Blender-authored performances. They have letterbox,
depth of field, subtitles and voice timing, and they can be skipped. Music is adaptive: explore,
combat and boss layers, with stingers on phase changes.
