# Systemic Design and Rule Systems

Deep-dive reference for designing rule systems that generate emergent behavior. Load this when designing rule systems, building a systemic game, or diagnosing why a game's systems feel inert.

---

## Table of Contents

1. [Systemic Design Philosophy](#systemic-design-philosophy)
2. [The Player's Mental Model](#the-players-mental-model)
3. [State-Space Decomposition](#state-space-decomposition)
4. [Permissions, Restrictions, and Conditions](#permissions-restrictions-and-conditions)
5. [Consistency](#consistency)
6. [Communicating Systems to Players](#communicating-systems-to-players)
7. [Worked Example: Breath of the Wild as Systemic Design](#worked-example-breath-of-the-wild-as-systemic-design)
8. [Diagnostic Questions](#diagnostic-questions)

---

## Systemic Design Philosophy

**Content-driven vs. systemic design**: Content-driven games expand by adding more stuff — more levels, more enemies, more items. Each piece of content is hand-crafted and has a fixed cost. Systemic games expand by adding rules that all existing content responds to. The cost is the rule; the payoff scales with the number of objects already in the game.

The systemic payoff: adding a "flammable" rule to a game with 100 objects instantly creates 100 new interactions. Adding a "wet objects don't burn" restriction creates 100 more. You didn't build 200 pieces of content — you wrote two rules. This is why systemic games can feel larger than their content budget suggests.

**The Playtank approach** (from "Your Next Systemic Game"): Model → Deconstruction → Reconstruction. Start with the player's mental model of the experience. Deconstruct it into the states and rules that would produce that experience. Reconstruct it as a coherent system. The model is the design target; the rules are the mechanism.

---

## The Player's Mental Model

The player's mental model is the most important design artifact — not the mechanics, not the theme. The mental model is the player's working theory of how the game works: what they can do, what the world does, and how those interact.

**Why the model comes first**: Designers who start with mechanics often build systems that are internally consistent but don't produce the experience they intended. Starting with the model — "the player should feel like a cunning predator who uses the environment against prey" — gives every rule a test: does this rule support that model?

### Finding Your Model

From Playtank's framework, ask these questions to surface the model:

- **Activities**: What does the player actually do, moment to moment? (Explore, craft, fight, negotiate)
- **Role**: What role does the player inhabit? (Survivor, detective, god, underdog)
- **Mystery**: What does the player want to discover? (World lore, optimal strategy, hidden mechanics)
- **Adversity**: What opposes the player? (Enemies, environment, time, the player's own limitations)
- **Goals**: What is the player trying to achieve? (Short-term and long-term)
- **Hook**: What makes this game different from others in its space?
- **Shared Fantasy**: What fiction does the player buy into?

**Immersive research**: Before designing rules, research the model's domain. A survival game set in a frozen wilderness benefits from reading about cold-weather survival, not just playing other survival games. History, mythology, and domain expertise surface rules that feel authentic rather than arbitrary.

**Key technologies**: Every game has a small set of technologies it cannot do without — the rules that are load-bearing for the model. Identify these early. They should be protected from scope cuts; everything else is negotiable.

---

## State-Space Decomposition

To design a systemic game, you need to know what states exist and how they interact. State-space decomposition is the process of enumerating those states before writing rules.

### Application States

The full state of the game application at any moment:

- **Menu states**: Title screen, settings, pause menu. These retain no simulation data.
- **Setup states**: Character creation, difficulty selection, level loading. These retain data (player choices, configuration) but don't run the simulation.
- **Simulation states**: The game is running. This is where systemic rules operate.

### Simulation States

Within the running simulation, three categories of state:

- **Logical states**: Physics, animation, collision. The engine's model of the world.
- **Movement states**: Running, jumping, swimming, flying. How entities traverse the space.
- **Interaction states**: Lock-on, lockpicking, conversation, crafting. How entities engage with each other.

### Object Categories

Objects are the entities that carry state and respond to rules:

- **Locations**: The world broken down by granularity — regions, zones, rooms, tiles. Locations have their own states (explored/unexplored, safe/dangerous, day/night).
- **Characters**: Defined more by their external relationships and behaviors than by their internal properties. A guard is defined by their patrol route, their faction, their awareness state — not by their hit points alone.
- **Props**: Objects held or activated by characters. A torch is a prop; it carries a "lit" state that interacts with the flammable rule.
- **Devices**: Objects that carry narrative state — faction flags, objective markers, locked doors. These bridge the simulation and the authored story.

### Object States

Each object can carry multiple independent state dimensions:

| State Type | Description | Example |
|---|---|---|
| **Condition** | Physical status | Broken, burning, frozen, starving |
| **Context** | Spatial relationship to other objects | Behind cover, above ground, close to water |
| **Response** | How the object handles system interactions | Flammable, conductive, fragile |
| **Awareness** | Internal information the object tracks | Health, ammo, hunger, temperature |
| **Perception** | External stimuli the object has registered | Seen, heard, smelled, alerted |
| **Scripted** | Designer exceptions and tools | Quest-locked, invincible, tutorial-only |

The scripted state category is where designers override the system for authored moments. Use it sparingly — every scripted exception is a rule violation that players may notice.

---

## Permissions, Restrictions, and Conditions

Every systemic rule can be decomposed into three types. Getting this decomposition right is the core discipline of systemic design.

### Permissions

What you can do. Permissions are the positive rules — the interactions that are possible.

- "Wood burns."
- "Enemies can be knocked back."
- "Water conducts electricity."
- "Characters can climb any surface with a handhold."

Permissions define the possibility space. A game with few permissions has few interactions. A game with many permissions has many interactions — but only if those permissions interact with each other (see the "Interplay and Counterpoint" section in `depth-and-dynamics.md` if not already loaded).

### Restrictions

Exceptions to permissions. Restrictions are what prevent permissions from being universally applicable.

- "Wet wood doesn't burn."
- "Bosses resist knockback."
- "Pure water doesn't conduct electricity."
- "Characters cannot climb surfaces covered in ice."

Restrictions are where depth lives. A permission without restrictions is a universal rule — it applies everywhere and creates no decisions. A permission with well-designed restrictions creates situations where the player must reason about whether the permission applies.

**The restriction test**: For every permission, ask "when does this NOT apply?" The answer is your restriction. If you can't think of a meaningful restriction, the permission may be too narrow to generate depth.

### Conditions

The framework that determines when permissions and restrictions are active. Conditions are the environmental and contextual rules that govern the other two.

- "Most wood is in the forest." (Condition that determines where the burn permission is relevant)
- "Bosses appear every 5th room." (Condition that determines when the knockback restriction applies)
- "Water is only found in caves." (Condition that determines where the conductivity permission matters)

Conditions create the situations where permissions and restrictions interact. A game with rich permissions and restrictions but no conditions will feel like a sandbox without stakes — the rules are there, but nothing forces the player to engage with them.

### Designing Gestalts

A **gestalt** is a collection of permissions and restrictions that defines an entity's systemic identity. Character classes, weapon types, and enemy archetypes are all gestalts.

**Example gestalt — a fire mage enemy**:
- *Permissions*: Casts fire spells, ignites terrain, immune to fire damage
- *Restrictions*: Vulnerable to water, cannot cast while moving, has a cast time
- *Conditions*: Appears in volcanic areas, spawns near flammable terrain

The gestalt creates a systemic identity that interacts with the player's own gestalt and with the environment. A fire mage in a stone room is a different encounter than a fire mage in a wooden building — the same rules produce different situations.

---

## Consistency

Consistency is what makes systemic rules trustworthy. Without consistency, players cannot reason about the game — they can only guess. With consistency, players can form intentions (see the "Church's Formal Abstract Design Tools" section in `frameworks.md` if not already loaded) and execute strategies.

### Predictability

Same inputs → same outputs. Physics should behave the same. If fire damages wood in area A, it must damage wood in area B. If the grappling hook works on ledges, it must work on all ledges — or the restriction must be visible and learnable.

Predictability is violated by:
- Silent exceptions (the rule applies everywhere except this one place, for no visible reason)
- Context-dependent behavior that isn't communicated (the same action works differently depending on invisible state)
- Randomness that isn't disclosed (the rule sometimes applies and sometimes doesn't)

### Coherence

Rules work the same everywhere. This is predictability extended across the whole game — not just "this rule is consistent in this area" but "this rule is consistent across all areas, all game states, all contexts."

Coherence violations feel like bugs even when they're intentional. If the player learns "fire melts ice" in the tutorial and then discovers that fire doesn't melt ice in the final boss arena (for balance reasons), they will feel cheated. The restriction needed to be visible from the start.

### Variability

Once consistent rules exist, mix inputs to create variety. A blind guard + metal floor = interesting scenario. A fire spell + wooden bridge = emergent tactic. Variability is the payoff for consistency — because the rules are predictable, the player can reason about novel combinations.

**The variability principle**: Don't design specific scenarios. Design rules that generate scenarios. A level designer who places a blind guard on a metal floor didn't design a "stealth puzzle" — they created conditions where the player's knowledge of the rules generates a puzzle. The designer's job is to create interesting conditions; the rules do the rest.

### Extensibility

Consistent rules can be extended in four ways:

- **Systems changing rules**: Weather, time of day, modifiers that alter which rules are active. Rain disables fire; night enables stealth.
- **Systems making rules**: Random weapon effects, procedural modifiers, loot tables. The system generates new rule combinations.
- **Players changing rules**: Mutators, custom modes, difficulty settings. The player modifies the rule set.
- **Players making rules**: Emergent game modes invented by players. Halo's "zombie" mode wasn't designed — players invented it by agreeing to a set of restrictions. This is the highest form of extensibility.

---

## Communicating Systems to Players

The best systemic rules are discovered through play. The worst are explained through tutorials.

### The Communication Hierarchy

1. **Play, Don't Show**: Create situations where the rule is the obvious solution. The player discovers the rule by solving the problem. No explanation needed.
2. **Show, Don't Tell**: When play-based discovery isn't possible, demonstrate the rule visually. Animation, visual feedback, environmental storytelling.
3. **Tell** (last resort): Explain the rule in text or dialogue. Use only when the rule is too complex or too dangerous to discover through play.

For full treatment of this hierarchy, see the "Communicating Rules to Players" section in `player-experience.md` if not already loaded.

### The Inverted Pyramid

Lead with the most important element. In systemic rules, get the core permission across first, then add restrictions and conditions.

**Bad**: "You can ignite flammable objects with fire, but only if they're dry, and only if the weather isn't rainy, and only if you have the fire upgrade."

**Good**: "Fire ignites flammable objects. Wet objects resist fire. Rain suppresses fire."

The player needs to internalize the permission before they can process the restrictions.

### Perceived Affordances

Visual cues that communicate interaction possibilities. Flammable things should look flammable. Conductive things should look conductive. When affordances are clear, players discover rules through play because the visual language tells them what to try.

**Affordance failure**: When a rule exists but the affordance doesn't communicate it, players feel cheated by deaths they couldn't predict. The rule isn't wrong — the affordance is. Fix the visual language before fixing the rule.

### Boundaries

Every rule needs clear boundaries: where does it begin and end? A rule without clear boundaries creates confusion about when it applies. The player who doesn't know whether the fire rule applies to this specific object will either avoid the interaction (losing depth) or feel cheated when it doesn't work (losing trust).

---

## Worked Example: Breath of the Wild as Systemic Design

Breath of the Wild is the canonical modern example of systemic design done well. Its rule set is small; its interaction space is enormous.

### The Core Permissions

- Wood burns when exposed to fire.
- Metal conducts electricity and attracts lightning.
- Objects are affected by physics — they can be pushed, thrown, and fall.
- Wind affects fire direction and spread.
- Enemies react to environmental changes (fire, electricity, physics).

### The Core Restrictions

- Some surfaces are fireproof (stone, metal).
- Some objects are too heavy to move with physics alone.
- Fire requires a source — it doesn't spontaneously appear.
- Lightning only strikes during thunderstorms.

### The Core Conditions

- Weather changes which rules are active. Rain disables fire; thunderstorms enable lightning conductivity.
- Terrain determines which materials are present. Forests have wood; mountains have metal.
- Time of day affects enemy awareness states.

### The Emergent Possibility Space

From these few rules:

- A player who cuts down a tree (physics) near a campfire (fire source) creates a burning log that rolls downhill (physics + fire + terrain) into an enemy camp (enemy reaction).
- A player who equips a metal weapon during a thunderstorm (conductivity condition) takes lightning damage — a restriction the player discovers through play because the affordance (metal looks conductive) is clear.
- A player who lights a fire in a valley (fire + wind) creates an updraft that carries them upward on their paraglider — a combination the designer didn't script but the rules enable.

### Why It Works

The affordances are clear. Wood looks flammable. Metal looks conductive. The player can look at an object and form a hypothesis about how the rules apply to it. When the hypothesis is correct, the player feels clever. When it's wrong, the player learns a restriction — and that restriction becomes a tool.

The rules are consistent. Fire always behaves the same way. The player who learns "fire spreads to dry grass" in the first hour can apply that knowledge in the final dungeon. The game never violates its own rules for balance reasons.

---

## Diagnostic Questions

**Rule quality:**
- Can every rule be decomposed into permissions, restrictions, and conditions?
- Does each permission have at least one meaningful restriction?
- Are restrictions visible through affordances, or are they invisible exceptions?

**Consistency:**
- Does this rule apply everywhere it logically should?
- If there's an exception, is it communicated through a visible restriction?
- Can the player form a hypothesis about how the rule works and test it?

**Systemic payoff:**
- How many interactions does this rule create with existing content?
- Does adding this rule change how the player thinks about existing rules?
- Could this rule be extended (weather, modifiers, player customization)?

**Communication:**
- Can this rule be taught through play? If yes, is it?
- Are the affordances clear enough that players can form hypotheses?
- Does the rule match player intuitions, or does it require overriding them?

For depth analysis of how rules create interplay, see the "Interplay and Counterpoint" section in `depth-and-dynamics.md` if not already loaded. For how to document systemic rules as design artifacts, see `design-artifacts.md` if not already loaded.
