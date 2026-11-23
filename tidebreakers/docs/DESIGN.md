# Tidebreakers — design

A third-person action brawler with a story, in Babylon.js on WebGPU. Five chapters plus a prologue and
epilogue, about 50 minutes for a first playthrough. Bright, saturated, anime-adventure look; a story about
a ragged crew of people who each lost someone, and the will they inherit.

An original world and cast, in the spirit of big-hearted pirate adventure manga: island-hopping arcs,
a crew gathered one tragedy at a time, an Armada that rules the sea "for everyone's good", and a hero
who fights with the storm in his chest.

## World

**The Scattered Sea**: a thousand islands under the **Gilded Armada**, a navy that swore to end piracy
and the great storms both. Its Grand Admiral, **Severin Vale**, hunts the **Sunken Crown**, a relic
from the drowned city of **Ys-Marrow** that is said to still the sea itself.

**Stormpearls** form, very rarely, where a hurricane dies over deep water. Whoever swallows one carries
the storm: wind answers their fists, and their feelings move the weather. Lose yourself, and the storm
takes you.

## Cast

| Who | Role | Silhouette |
|---|---|---|
| **Kai Marlowe** (17) | player. Loud, hungry, fearless, loves his friends more than sense. Swallowed a Stormpearl at 7 | spiky dark hair, long red headband tails, short orange sleeveless jacket, wrapped forearm gauntlets, rolled trousers, sandals |
| **Grandma Ines** (74) | raised Kai on Gull's Rest; once navigator of the pirate ship *Merry Albatross*, whose whole crew the Armada hanged | small, stooped, tricorn, long coat, cane |
| **Mira Sorrel** (18) | harpoon fighter of Ashport, saboteur, joins in Chapter 2 | long silver braid, green scarf, cropped coat, harpoon-spear |
| **Bram Oakhart** (34) | gentle giant cook of the Drowned Market, ex-Armada, joins in Chapter 3 | huge, bald, beard, apron over striped shirt, anchor-ladle |
| **Nell Finch** (12) | lighthouse keeper of the Weeping Shoals, navigator, joins in Chapter 4 | big goggles, oversized coat, satchel, brass gull "Tick" |
| **Commodore Halvard Crane** | Vale's enforcer; burns Gull's Rest; boss of Chapters 1 and 3 | tall, white-and-gold uniform, cape, halberd |
| **Baron Gorrick Vane** | master of the Ashport mines; boss of Chapter 2 | huge belly, top hat, iron arm, chains |
| **The Weeping Maw** | ancient sea serpent drawn to the Shoals' light; boss of Chapter 4 | coiled serpent, lantern-lure, barnacled plates |
| **Grand Admiral Severin Vale** | final boss, two phases | silver hair, white greatcoat, gold epaulettes, sabre, then the Crown |
| Armada marines, riflemen, shield brutes, elites; Ashport thugs | enemies | shared rig, distinct gear and colours |

## Backstories (the heart of it)

- **Kai**: his mother **Seren** kept the Gull's Rest light. The night of the Great Squall she rowed out
  to a ferry breaking on the reef and never came back. Kai, seven, waded in after her; the storm died
  over his head and left the pearl in his hand. He still carries her storm lantern.
- **Ines**: thirty years ago the Armada hanged the crew of the *Merry Albatross* on the Gull's Rest
  cliffs. Ines, the navigator, was ashore buying bread. She stayed on the island so someone would
  remember them, and she raised a drowned woman's son.
- **Mira**: her little brother **Teo** worked the Ashport mines to pay their debt. When a seam flooded,
  Baron Gorrick sealed the tunnel to save the ore. Mira has been sabotaging the mines alone for three
  years. In the sealed tunnel she finds Teo's chalk drawings: *"Mira will come."*
- **Bram**: as an Armada sergeant he obeyed Halvard's order to fire on a "pirate" ship that was full of
  families fleeing a famine. He threw one lifebuoy, then deserted. He feeds every refugee in the
  Drowned Market for free and has never forgiven himself. A woman he fed for years, **Hana**, turns out
  to be the girl who caught that lifebuoy.
- **Nell**: her father, the cartographer **Elias Finch**, rowed out into the Shoals two years ago and
  never came back. She has kept the light burning ever since and floats a letter to him every night.
  In the Maw's wreck-hoard she finds his last letter, written to her.
- **Vale**: his wife and daughter **Lissa** drowned when the Great Squall sank their ferry off Gull's
  Rest, the same night Seren rowed out. He blames the sea and everyone who loves it. He wants the
  Crown so no one ever loses anyone to it again, even if every ship in the world rots in still water.
  The last thing Seren did was put Lissa into a lifeboat. Lissa didn't survive the night; Seren's
  lantern was found in the boat beside her.

## Chapters

Each chapter: walk-and-talk exploration, 3–5 arena fights that wall the player in, story scenes,
and a boss. Checkpoints at every arena. Target 8–11 minutes each.

### Prologue — The Lantern (2 min)
Flashback, night, rain. Seren's lantern on the water; a child's hand closing round a glowing pearl.
Title card.

### 1. Gull's Rest (8–9 min) — green, golden afternoon
1. Sparring with Grandma Ines on the lighthouse green (movement, light/heavy, dodge, block/parry tutorial).
2. Armada ships in the bay. Halvard's marines march into the village. Fight in the market lane.
3. Riflemen on the dock; fight along the boardwalk (ranged enemies, lock-on).
4. The cliff path to the lighthouse (brutes with shields; Gale Burst unlocked).
5. **Boss — Commodore Halvard** at the lighthouse. He wins the duel: phase change cut short when
   Ines steps in front of a halberd meant for Kai.
6. Ines, dying, gives Kai the *Albatross*'s logbook and her coat. "Find a crew, Kai. Don't sail alone
   like I did." The lighthouse burns. Kai sails out on her little sloop, the *Wren*.

### 2. Ashport (9–10 min) — orange smog, chimneys, dusk
1. Docking at Ashport; children carrying coal sacks. A harpoon pins a thug's sleeve: Mira.
2. Fights through the foundry streets with Mira as an ally.
3. The mine lift and the tunnels (thugs, rail carts, overseers).
4. The sealed tunnel: Teo's chalk drawings. Mira breaks. Kai: "Then we came. Both of us."
5. **Boss — Baron Gorrick Vane** at the ore furnace (chain sweeps, furnace vents, iron-arm slams).
6. The children walk out into daylight. Mira joins.

### 3. The Drowned Market (9–10 min) — lantern night on moored boats
1. A city of lashed-together hulls. Bram's free soup kitchen. Hana and the refugees.
2. Armada raid: Halvard has come for the "deserter". Fights across rocking decks (Mira ally).
3. Bram confesses the lifebuoy. He means to surrender himself to spare the market.
4. Kai refuses to let him. Fights to the flagship's gangway with Bram fighting beside him.
5. **Boss — Commodore Halvard (rematch)** on the burning market barge, two phases.
6. Hana tells Bram she was the girl in the water. Bram joins.

### 4. The Weeping Shoals (9–10 min) — storm, rain, lightning
1. Sailing through the storm wall. A small light on a rock: Nell, alone.
2. Nell's lighthouse; her letters in bottles. Wreckers raid the light; fights on the rocks.
3. The Maw rises. A running fight across the wreck-field to the *Wren*.
4. **Boss — The Weeping Maw**, fought from the *Wren*'s deck and the wreck it guards.
5. In the hoard, Elias's last letter. Nell reads it aloud and can't finish; Kai finishes it for her.
6. Nell relights her lantern for the last time and joins as navigator.

### 5. The Sunken Crown (11–12 min) — white-gold citadel, then the risen city
1. The Armada's citadel at Vale's Reach. The crew splits up: each friend holds a gate.
2. Fights through the marble halls and the elite guard.
3. Vale raises Ys-Marrow; the sea goes glassy and still.
4. **Boss — Grand Admiral Severin Vale**, phase 1 (sabre duel) and phase 2 (the Crown: stillwater
   waves, frozen spears of sea). Kai's storm starts to take him; the crew's voices pull him back.
5. Kai gives Vale Seren's lantern; it was in Lissa's lifeboat. Vale breaks the Crown himself, and the
   tide comes back in.

### Epilogue — The Wake (2 min)
Dawn. The *Wren* under full sail, the crew on deck, Kai hanging Seren's lantern at the bow.
Ines's voice reading the first line of the logbook. Credits.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / camera | WASD / mouse | left / right stick |
| Light attack | left click or J | X / Square |
| Heavy attack (hold to charge) | right click or K | Y / Triangle |
| Jump | Space | A / Cross |
| Dodge (i-frames) | Shift | B / Circle |
| Guard (tap just before a hit to parry) | Q | LB |
| Gale Burst / Tempest Dash | E / R | RB / RT |
| Crew assist | C | LT |
| Stormheart (super, full Resolve) | F | L3+R3 |
| Lock on | Tab or middle click | R3 |
| Advance dialogue | Space / click | A |

## Art direction

Cel-shaded anime adventure: thick inverted-hull outlines on characters, crisp two-to-three band
shading with a soft terminator, coloured shadows (cool blue in day, violet at night), rim light, hair
"angel ring" highlights, painted gradients on skin, saturated sea and sky, soft bloom, speed lines and
impact frames on big hits. Every chapter has its own palette and grade.
