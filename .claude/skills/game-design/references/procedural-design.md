# Procedural Design

Procedural generation as a design technique — when to use it, how to choose a method, and how to make generated content feel meaningful. Load this when considering procedural generation for any game system, or when diagnosing why generated content feels shallow or repetitive.

---

## What Procedural Generation Is For

**Source:** Kate Compton, "Practical Procedural Generation for Everyone" (GDC 2016).

Procedural generation (PCG) is not a technical feature — it's a design tool. Use it when:

- You need more content variation than you can hand-craft
- Replayability requires that players encounter genuinely different experiences
- The design space is too large to enumerate manually
- You want players to feel like discoverers, not consumers

PCG is not magic. Simple generators often produce better results than complex ones. The goal is not algorithmic sophistication — it's meaningful variation.

---

## The Design Process for Generators

1. **Define specifically what you're generating.** "A novel" is too broad to generate. "A trashy urban romance fantasy" has enough constraints to build a generator. The more specific the target, the better the generator.

2. **Enumerate your constraints.** What must be true of every output? What must never be true? Constraints are not limitations — they're the shape of your possibility space.

3. **Choose a generative method** (see catalog below).

4. **Iterate and be flexible.** Follow your generator where it leads. The best generated content often comes from unexpected outputs that suggest a better direction than the original plan.

---

## The Generator Catalog

### Tiles
Chunk-based assembly. A set of pieces that socket together to form a larger structure (maps, levels, dungeons).

**Use when:** Content can be broken into equal-sized regions; tile-to-tile placement doesn't need strict constraints; emergence from placement is desirable (mountains next to research tiles in Civ).

**Examples:** Diablo levels, Spelunky, Catan board, shuffled card decks (solitaire is tile-based PCG).

### Grammars
Recursive definition. A recipe that expands into sub-recipes, all the way down to concrete elements.

**Use when:** You want to recursively define things with other things; content has a hierarchical structure (story → scene → character → name → syllable).

**Examples:** Tracery (text generation), L-systems (plant growth), Zelda dungeon generation (replacement grammars that perturb a straight line into a complex dungeon with locks and keys).

### Distribution
Placement of elements across a space. Dump things onto a map until the map has stuff.

**Use when:** You need to populate a space with objects; density and clustering matter.

**Warning:** True random distribution looks wrong. Real distributions are hierarchical and clustered. Three useful techniques:
- **Borling** — large objects surrounded by medium objects surrounded by small objects (fractal hierarchy)
- **Footing** — where two things intersect, show awareness of the intersection (dirt around a tree base)
- **Gribling** — add texture and detail to surfaces (Star Wars vs. Star Trek aesthetic)

### Parametric
A set of sliders that define a possibility space. Each point in the N-dimensional parameter space is a unique output.

**Use when:** You want smooth variation across a continuous space; you want to animate between states; you want genetic algorithms or evolutionary search.

**Examples:** Spore creature creator (32 parameters), No Man's Sky creatures, procedural flowers.

### Interpretive
Transform input data into different output data. Complexify or reinterpret existing information.

**Use when:** You have a source (skeleton, map, motion path) and want to derive something from it (creature mesh, decorated map, animated trail).

**Examples:** Spore's creature pipeline (skeleton → metaballs → UV maps → painted texture), Pokémon Go map decoration, procedural texturing.

### Simulation
Agent-based or physics-based systems that run forward in time to produce emergent history.

**Use when:** You want generated worlds with genuine history; you want emergent narrative from interacting systems.

**Examples:** Dwarf Fortress (simulates thousands of people living their lives to generate towns with history), Bad News (generates village history for a mystery game).

---

## Subtractive Methods: Filtering Bad Output

Generators produce both good and bad outputs. Subtractive methods filter or select:

**Seed whitelisting:** Run the generator many times, save the seeds of good outputs. Faster than fixing the algorithm. Use when you need a specific number of good outputs and iteration time is limited.

**Generative testing:** Write an algorithm to judge quality, then generate-and-discard until you get something that passes. **Warning:** If your quality filter is too strict, you'll generate forever without accepting anything. Use ranking/prioritization instead of hard rejection.

**Search:** Brute-force or hill-climbing search through the possibility space for outputs with desired properties. Genetic algorithms work well with parametric models.

**Constraint solving:** Describe the problem as constraints (jealousy implies motive, motive implies murder suspect) and use a solver to find valid configurations. **Warning:** Don't write your own solver. Use an existing one. Writing solvers is how cool indie projects never ship.

---

## The 10,000 Bowls of Oatmeal Problem

A generator can produce mathematically unique outputs that feel identical to players. This is the oatmeal problem — technically different, perceptually the same.

**Three levels of generated content:**

1. **Perceptual differentiation** — outputs don't look like clone stamps, but aren't meaningfully unique (background trees)
2. **Perceptual uniqueness** — outputs are noticeably different from each other (biome regions)
3. **Characterful** — outputs have enough personality that players would write fanfic for them (the angry nun in a wedding dress from a character generator)

Know which level you need. Background content needs level 1. Named characters need level 3.

**The fanfic test:** Would a player write fanfic for this generated object? If yes, it's characterful. If no, it may be perceptually unique but not emotionally resonant.

---

## Ownership: The Most Underrated PCG Design Principle

Players who discover interesting generated content and can claim it as their own become invested in the game in a way that hand-crafted content can't replicate.

**The Victorian explorer phenomenon:** Give players a vast space to explore, let them find interesting things, let them label those things with their names, and let them show their discoveries to others. This is the core of Dwarf Fortress's community — half the game is played on storytelling boards where players present their generated stories.

**Design for ownership:**
- Let players find content before you show it to them
- Give players ways to name, share, and display their discoveries
- Promote player-found content (Spore promoted player creatures)
- Let players become creators, curators, and retailers of generated content

This is also why PCG and streaming work well together — players self-promote using your generated content.

---

## Multiple Axes of Randomness

When you need high variety, don't just add more content in one dimension. Add axes:

- 10 encounter types × 5 enemy variants × random bosses × random mods = 10,000+ combinations from 5× the work of 50 hand-crafted encounters

Each axis multiplies the others. The player never sees a "perfect" encounter on all axes, so there's always a better one ahead.

---

## Diagnostic Questions

- What specifically are you generating? Is the target specific enough to constrain a generator?
- Which method fits your content type? (tiles for maps, grammars for text, simulation for history)
- Are you filtering bad outputs, or trying to make the generator never produce them?
- Is your generated content perceptually differentiated, unique, or characterful — and do you need the right level?
- Are players able to discover and claim ownership of generated content?
- Have you added multiple axes of randomness, or are you generating in one dimension?

For how procedural generation relates to systemic design and emergence, see `systems-and-rules.md` and `depth-and-dynamics.md` if not already loaded. For how procedural content supports live service design, see `live-design.md` if not already loaded.
