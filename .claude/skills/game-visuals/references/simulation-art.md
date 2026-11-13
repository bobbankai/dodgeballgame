# Art in the Service of Simulation

Principles for art direction in simulation and sandbox games, where every visual asset must communicate system state. Load this when making a city builder, strategy game, or any game where art represents underlying simulation data.

---

## Table of Contents

1. [The Central Question](#the-central-question)
2. [Art as Information Layer](#art-as-information-layer)
3. [Constraint-Driven Art Direction](#constraint-driven-art-direction)
4. [Post-Processing as Unification](#post-processing-as-unification)
5. [Art Directing Procedural Systems](#art-directing-procedural-systems)
6. [Colorblind Accessibility at Scale](#colorblind-accessibility-at-scale)
7. [Anti-Patterns](#anti-patterns)

---

## The Central Question

Every piece of art in a simulation game must answer: **what job are you doing for the simulation?**

In SimCity 4, the aesthetic goal was "pile on detail" — model doorknobs, doormats, window latches. The detail was visually rich but semantically vacuous. A child's playset in a backyard didn't mean there was a child there. Cars parked in front of a house didn't mean anyone was home. The art looked like a city but didn't *tell you* anything about the city.

In SimCity 2013, the goal shifted: **every piece of art should tie back to what's actually happening in the simulation.** Garbage cans on a lot mean garbage is ready for pickup — and when it's collected, the cans disappear. Cars in a driveway mean someone is home right now. The detail is there to communicate state, not to fill visual space.

This is the core principle: **in a simulation game, the art is UI.** Buildings, vehicles, characters, terrain — all of them are doing the job of telling the player what's going on in the simulation underneath.

---

## Art as Information Layer

### Category and State

Every visual asset needs to communicate two things:
- **Category**: What type of thing is this? (Residential vs. commercial vs. industrial; fire station vs. hospital; low-wealth vs. high-wealth)
- **State**: What condition is it in? (Under construction, abandoned, thriving, on fire, crime wave)

These must be readable **at a glance**, from a distance, while the player is managing other things. If a player has to zoom in and examine an asset to understand its state, the art has failed its job.

### The Simulation Thermometer

Visual elements can function as real-time readouts of simulation data:
- Lit windows in a building = percentage of occupancy (more lights = more people)
- Vehicle quality on roads = wealth level of the neighborhood (beaters vs. luxury cars)
- Animation speed/intensity of industrial buildings = production rate
- Seasonal foliage state = time of year in the simulation

**The principle**: Don't animate things arbitrarily. Bind animations and visual states to simulation parameters. The visual becomes a live readout, not decoration.

### Readable States Without Ambiguity

When a building is abandoned, it must look *unambiguously* abandoned — not just slightly different from a normal building. The player needs to read states instantly without conscious effort. This requires:
- **Exaggerated visual differentiation**: Abandoned buildings in SimCity look dramatically deteriorated, not subtly worn
- **Consistent visual language**: The same visual treatment means the same state everywhere in the game
- **Redundant cues**: Use multiple channels (color, geometry, texture, animation) to communicate the same state so it's readable even at small sizes or low detail levels

---

## Constraint-Driven Art Direction

### Scale as the Primary Constraint

In a sandbox game, art must work when **spammed across a huge landscape**. A beautiful building that looks great in isolation may look terrible when 500 copies of it tile across a city. Every technical solution must be validated at worst-case scale.

This constraint drives every art decision:
- Polygon budgets are set by how many buildings can be on screen simultaneously
- Texture budgets are shared across entire categories, not per-asset
- Animation systems must handle thousands of instances, not dozens

### Constraint as Creative Catalyst

Working within severe constraints forces better solutions than unlimited resources would produce. SimCity's facade mapping system (a library of architectural elements — windows, doors, trim — that can be recombined across buildings) emerged from the constraint of not being able to afford unique textures for every building. The result was more architecturally coherent than hand-crafted unique textures would have been, because the elements shared a visual vocabulary.

**The principle**: Identify your constraints early, work with engineers to find solutions, and let the constraints drive the art direction rather than fighting them.

### Palettization for Variety

When you can't afford unique assets for every variation, palettize: create a base asset with color regions defined as masks, then re-tint those regions to generate variety. The same building architecture reads as different buildings with different color schemes. The same character model reads as different wealth levels with different clothing palettes.

**The principle**: Separate structure from color. Structure is expensive to produce; color variation is cheap. Design assets so color is a variable, not baked in.

---

## Post-Processing as Unification

Raw assets dumped into a scene look like "a bunch of stuff spewed into the landscape" — no visual coherence, no sense of unified space. Post-processing is what binds a scene together:

- **Tone mapping**: Converts the raw HDR frame buffer into a perceptually correct exposure
- **Color grading**: Unifies the color space across all assets — artists working independently produce colors that don't quite harmonize; a color LUT (lookup table) corrects this at the scene level. **Important**: Lock down color grading before artists finalize their work, or they'll compensate for it and you'll chase your own tail.
- **Ambient occlusion**: The "spackle" that grounds objects in the scene. Without it, buildings look like they're floating on the landscape. With it, alleyways darken, objects cast contact shadows, and the scene reads as one unified space rather than a collection of separate assets.
- **Atmospherics**: Creates spatial depth by differentiating foreground from background. Objects fade toward the sky color with distance, giving the player a sense of scale and depth.

**The principle**: Don't expect raw assets to look good in combination. Budget time and effort for scene-level unification passes.

---

## Art Directing Procedural Systems

In a sandbox game, the player creates content — they draw roads, zone land, place buildings. The art director is **indirectly art directing the player**: designing systems that produce beautiful results regardless of what the player does.

This is "art directing on stilts." You can't control the output directly; you can only design the system. The system must:
- Produce coherent results for any valid player input
- Fail gracefully for edge cases (unusual road intersections, extreme terrain)
- Guide the player toward aesthetically good choices without forcing them

**Terrain legibility example**: SimCity 2000's terrain clearly communicated buildability — flat = buildable, steep = not. SimCity 2013 maintained this legibility even with a more naturalistic aesthetic by designing terrain to have sharp, readable cliff faces rather than smooth gradients. The terrain's visual language told the player what was possible without a tutorial.

---

## Colorblind Accessibility at Scale

When color is your primary information channel (as it is in a simulation game with data overlays), colorblind accessibility is not optional. About 5–6% of players are colorblind.

Color lookup tables (LUTs) make this cheap: run daltonization transforms in Photoshop on your neutral LUT, export the result, and load it as a colorblind mode. The entire game's color space remaps automatically. There are three common forms of colorblindness — implement transforms for all three.

---

## Anti-Patterns

**Detail without meaning**: Modeling doorknobs and doormats when the player can't interact with them and they don't communicate simulation state. Visual complexity that doesn't serve information.

**Arbitrary animation**: Animating buildings and characters for visual interest rather than binding animations to simulation data. Missed opportunity to make the visual layer a live readout.

**Ambiguous states**: Visual differences between states that are too subtle to read at game scale. If you have to zoom in to tell if a building is abandoned, the visual language has failed.

**Ignoring scale**: Designing assets that look good in isolation but fail when tiled across a landscape. Always validate at worst-case density.

**Post-processing as afterthought**: Treating scene unification (ambient occlusion, color grading, atmospherics) as polish rather than as a core part of the visual pipeline. These passes often do more for scene quality than any individual asset improvement.

**Locking color grading too late**: If artists finalize their work before color grading is locked, they'll compensate for the grade and you'll lose the unification benefit.
