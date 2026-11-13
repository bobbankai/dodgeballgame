# Design Artifacts

Practical templates for documenting and communicating game design decisions. Load this when you need to capture design in a shareable format, communicate decisions to a team, or structure a systemic game's design documentation.

---

## Table of Contents

1. [Why Artifacts, Not Documents](#why-artifacts-not-documents)
2. [Commitment Artifacts](#commitment-artifacts)
3. [Game Loops](#game-loops)
4. [One-Page Designs](#one-page-designs)
5. [State-Space Maps](#state-space-maps)
6. [Application State Maps](#application-state-maps)
7. [Worked Example: Systemic Survival Game](#worked-example-systemic-survival-game)
8. [Choosing the Right Artifact](#choosing-the-right-artifact)

---

## Why Artifacts, Not Documents

Traditional Game Design Documents (GDDs) are increasingly an antipattern. They're waterfall artifacts in an iterative discipline — comprehensive specifications written before the design is understood, then ignored as the design evolves.

The problem isn't documentation. It's the wrong kind of documentation. A 200-page GDD written before a single prototype is speculation, not design. It describes a game that doesn't exist yet and will never exist in that form.

**Modern practice**: Small, focused, living artifacts that evolve with the design. Each artifact captures one thing well. Artifacts are updated as the design changes; they're not written once and filed.

### Two Purposes

Every design artifact serves two purposes:

1. **Communication**: Sharing decisions with the team. A one-page design for a specific object tells the programmer what to implement, the artist what to create, and the designer what to test.

2. **Thinking**: Forcing the designer to work through implications. The act of writing a commitment artifact surfaces contradictions. The act of drawing a state-space map reveals isolated elements. Artifacts are thinking tools, not just communication tools.

---

## Commitment Artifacts

**Source:** Playtank, "Your Next Systemic Game."

The commitment artifact is the first document you create. It captures what the team has agreed on before detailed design begins. Its purpose is alignment — ensuring everyone is building the same game.

A commitment artifact is not a design document. It doesn't specify how things work. It specifies what the team has committed to: the non-negotiables, the shared references, the high-level goals.

### Shared References

Key references everyone on the team needs to experience. Not a comprehensive list — a curated set that communicates the intended experience.

- **Core inspirations** (1-2 games): The games that most closely capture the intended experience. Everyone should play these.
- **Tone references** (movies, shows, books): The emotional register and aesthetic. A survival game might reference *The Road* for tone and *Annihilation* for atmosphere.
- **Mechanics research** (games to study): Games with specific mechanics the team should understand. Not necessarily inspirations — sometimes anti-inspirations ("we want to avoid the pacing problems of X").
- **Domain research** (activities, books, articles): Real-world research that informs the model. A game about mountaineering benefits from reading about mountaineering.

### Narrative Facts

Non-negotiables in the authored story:

- **That big set piece**: The moment everyone agrees must be in the game. The scene that justifies the project.
- **Characters and relationships**: The protagonist, the antagonist, the supporting cast. Not detailed backstories — just the relationships that matter.
- **Theme and setting**: What the game is about and where it takes place. One sentence each.
- **Major plot beats**: The beginning, the middle, the end. Not detailed — just the shape of the story.

### Gameplay Facts

Non-negotiables in the design:

- **Target platforms and control schemes**: PC, console, mobile. Controller, keyboard/mouse, touch. These constrain every design decision.
- **Level and object metrics**: How big is a room? How tall is a character? How far can the player see? These numbers constrain art, level design, and mechanics.
- **High-level goals**: Target playtime, session length, replayability expectations.
- **Verbs and actions**: What does the player do? Run, jump, shoot, craft, negotiate. The verb list is the game's mechanical identity.

---

## Game Loops

Every game has nested loops operating at different time scales. Documenting each loop separately forces clarity about what the game is at each scale — and reveals whether each scale is satisfying on its own terms.

### Micro Loop (Second-to-Second)

The core interaction. What the player does constantly. Jump, shoot, swing, build, match. The micro loop is the game's fundamental unit of play.

A good micro loop is satisfying in isolation — it should feel good to execute even without context. If the micro loop isn't satisfying, no amount of macro or meta design will save the game.

**Test**: Can a player enjoy the micro loop for 5 minutes with no goals, no progression, no context? If yes, the loop has intrinsic value. If no, the loop is a vehicle for something else — and that something else needs to carry the weight.

### Macro Loop (Minute-to-Minute)

The activity cycle. Clear a room, loot, move to the next room. The repeating pattern of micro loops. The macro loop gives the micro loop context and stakes.

A good macro loop has a clear goal, a series of micro loops that work toward that goal, and a reward that makes the goal feel worth pursuing.

### Meta Loop (Hour-to-Hour)

The progression arc. Complete a dungeon, upgrade gear, choose the next dungeon. What keeps players returning session after session. The meta loop gives the macro loop meaning and long-term motivation.

A good meta loop creates anticipation — the player ends a session with something to look forward to. It also creates a sense of progress — the player is meaningfully different after each session.

### Loop Template

Document each loop with this structure:

```
MICRO: [verb] → [feedback] → [decision] → [verb]
       Example: Swing sword → enemy staggers → choose to press or dodge → swing again

MACRO: [goal] → [series of micro loops] → [reward] → [new goal]
       Example: Clear the dungeon floor → fight through rooms → find the key → unlock the next floor

META:  [objective] → [series of macro loops] → [progression] → [new objective]
       Example: Defeat the boss → earn upgrade materials → unlock new abilities → attempt harder dungeon
```

**The loop test**: Each loop should be satisfying on its own. A player who only plays the micro loop (no macro context) should still enjoy it. A player who only plays the macro loop (no meta progression) should still feel motivated. If a loop only works in the context of the loop above it, it may not be strong enough on its own terms.

---

## One-Page Designs

**Source:** Playtank, "Your Next Systemic Game."

A one-page design captures one element of the game — an object, a system, a mechanic — on a single page. The constraint is the point: if it doesn't fit on one page, it's either too complex or needs to be split into multiple one-pagers.

One game can have 50-150+ one-page designs. Each is self-contained but connected to others through explicit relationships. Together, they form a complete picture of the game's design.

### Structure

Each one-page design contains:

- **Title**: Preferably a single word. OXYGEN. FIRE. GUARD. TORCH. The title is the element's identity.
- **Image**: A simple illustration or reference image. Communicates the visual identity faster than words.
- **Category**: References another one-page design if this element belongs to a category. TORCH → PROP. GUARD → CHARACTER.
- **Relationships**: Connections to other one-pagers. Use consistent formatting (bold, caps, color) to make relationships scannable. TORCH → FIRE (source), TORCH → WOOD (material), TORCH → GUARD (perception).
- **Inputs**: What goes into this element. What triggers it, what modifies it, what it consumes.
- **Outputs**: What comes out of this element. What it produces, what it triggers, what it affects.
- **Feedback**: What the player sees when this element is active. UI indicators, visual effects, sound cues.
- **Triggers**: Gameplay events this element fires. OnIgnite, OnExtinguish, OnPickup.

### The Relationship Discipline

Relationships are the most important part of a one-page design. An element with no relationships is an isolated element — it adds complexity without depth (see "Depth vs Complexity" in `depth-and-dynamics.md` if not already loaded).

When writing relationships, be specific about the direction: does this element affect the other, or does the other affect this element, or both? TORCH → FIRE means the torch is a source of fire. FIRE → TORCH means fire affects the torch. Both directions create different interactions.

### The One-Page Discipline

The one-page constraint forces decisions. If a design doesn't fit on one page:
- Is it too complex? Simplify it.
- Is it actually two elements? Split it into two one-pagers.
- Are the relationships doing too much work? Some relationships might belong on other one-pagers.

The discipline of fitting everything on one page is a design tool, not just a formatting rule.

---

## State-Space Maps

**Source:** Playtank, "Your Next Systemic Game."

A state-space map is the culmination of systemic design documentation. Take all your one-page designs, group them, and connect them to show relationships. The map is an overview of the entire design — where depth comes from (interconnections) and where complexity lives (number of nodes).

### What the Map Shows

- **What objects exist**: Every one-page design is a node on the map.
- **How they relate**: Every relationship is an edge on the map.
- **Where systems interact**: Clusters of densely connected nodes are where the game's depth lives.
- **What's isolated**: Nodes with few connections are candidates for removal or redesign.

### What the Map Does NOT Show

The map is not a specification. It doesn't show how things work — it shows what exists and how things connect. Details live in the one-page designs; the map shows the structure.

### Tools

- **Miro**: Digital whiteboard, good for remote teams. Supports color coding, grouping, and zooming.
- **XMind**: Mind-mapping tool. Good for hierarchical relationships.
- **Physical whiteboard**: Best for in-person teams. Post-its for nodes, markers for connections.
- **Post-its on a wall**: The most tactile option. Easy to move, easy to add, easy to remove.

### Reading the Map

**Isolated elements** (no connections): No interplay. Either add relationships or remove the element. An isolated element is pure complexity with no depth contribution.

**Overcoupled clusters** (too many connections): Unpredictable behavior. A node connected to everything will interact with everything in ways the designer can't anticipate. Consider whether some connections should be removed or mediated through an intermediate node.

**Healthy clusters**: 3-7 connections per node, with clear directionality. Dense enough to create depth; sparse enough to be predictable.

### Using the Map to Communicate

The state-space map is the most effective tool for communicating a systemic design to a team. It shows the design's structure at a glance — programmers see the data model, artists see the visual elements, designers see the interaction space.

Present the map before detailed specification. The map answers "what are we building?" before the one-page designs answer "how does each piece work?"

---

## Application State Maps

An application state map documents the player's journey through the game at the application level. It's not about gameplay — it's about the player's experience of the software from first launch to last session.

### Why This Matters

Application state maps feel pedestrian but teach you a lot about your game. They force you to think like a player encountering the game for the first time: What do they see first? How do they get into the game? What happens when they die? How do they return to the main menu?

Many games have broken application flows that frustrate players before they ever reach the gameplay. A player who can't figure out how to start a new game, or who loses progress because the save system is unclear, has a bad experience that has nothing to do with the game's design quality.

### Structure

Start from the player's perspective and map every screen and interaction:

```
Splash screen → Loading → Main menu
Main menu → New game → Character creation → Tutorial → Gameplay
Main menu → Continue → Loading → Gameplay
Main menu → Settings → Audio/Video/Controls → Main menu
Gameplay → Pause → Resume/Settings/Quit to menu
Gameplay → Death → Retry/Load checkpoint/Quit to menu
Gameplay → Level complete → Results screen → Next level/Main menu
```

Close the whole loop. Every path should have a way back. Every dead end is a design problem.

### State Categories

- **Menu states**: Title screen, main menu, pause menu. No simulation data. The player is navigating the application.
- **Setup states**: Character creation, difficulty selection, level loading. Retain data (player choices, configuration). The player is configuring the simulation.
- **Simulation states**: The game is running. The player is playing.

### What to Look For

- **Dead ends**: States with no exit. The player is stuck.
- **Missing paths**: States that should connect but don't. The player can't get from A to B.
- **Asymmetric flows**: The player can enter a state but can't exit it the same way. Entering settings from the pause menu should exit back to the pause menu, not to the main menu.
- **Data loss points**: Where does the player lose progress? Are these points clearly communicated?

---

## Worked Example: Systemic Survival Game

A minimal set of design artifacts for a hypothetical underwater survival game.

### Commitment Artifact

**Shared references:**
- *Subnautica* (game): Underwater exploration, base building, resource pressure, mystery
- *Don't Starve* (game): Resource management, environmental hostility, emergent survival stories
- *Annihilation* (film): Tone — wonder and dread simultaneously
- *Deep sea diving* (activity): Research the actual experience of depth, pressure, disorientation

**Narrative facts:**
- Solo protagonist, no other survivors
- A mysterious signal is drawing the player deeper
- Theme: the cost of curiosity
- Plot: descend → discover → decide whether to go further

**Gameplay facts:**
- First-person, PC and console
- 20-hour campaign, 45-minute sessions
- Core verbs: swim, craft, explore, survive
- Core metrics: visibility range decreases with depth; oxygen consumption increases with depth

### Game Loops

```
MICRO: Explore area → gather resource → monitor oxygen → return or push deeper
       The tension is the oxygen bar. Every decision is: is this worth the oxygen?

MACRO: Discover new biome → identify resource requirements → craft equipment → survive the biome
       Each biome requires new equipment. Equipment requires resources from the previous biome.

META:  Follow the signal → upgrade base → unlock new depths → uncover the mystery
       The signal is always deeper. The mystery pulls the player forward.
```

### One-Page Design: OXYGEN

**Title**: OXYGEN

**Category**: RESOURCE

**Relationships**:
- TANK (equipment — stores oxygen, increases capacity)
- DEPTH (environment — increases consumption rate)
- PLANTS (source — some underwater plants produce oxygen)
- BASE (refill point — return to base to refill)
- PRESSURE (environment — extreme depth reduces tank efficiency)

**Inputs**: Breathing consumes oxygen continuously. Depth multiplies consumption rate. Exertion (sprinting, crafting) increases consumption.

**Outputs**: Depletion triggers warning state. Full depletion triggers damage state. Damage state kills the player if not addressed.

**Feedback**: UI bar (always visible). Breathing sound intensifies as oxygen drops. Screen vignette appears at 25% oxygen. Heartbeat sound at 10% oxygen.

**Triggers**: OnOxygenLow (25%), OnOxygenCritical (10%), OnOxygenDepleted (0%), OnOxygenRefilled (100%)

### State-Space Map Sketch

The OXYGEN one-pager connects to:
- TANK (equipment system)
- DEPTH (environment system)
- PLANTS (resource system)
- BASE (progression system)
- PRESSURE (environment system)

DEPTH connects to:
- OXYGEN (consumption rate)
- PRESSURE (structural damage)
- LIGHT (visibility)
- TEMPERATURE (hypothermia risk)
- SIGNAL (the mystery — signal strength increases with depth)

From just these two nodes, a web of interplay emerges. DEPTH affects OXYGEN, PRESSURE, LIGHT, TEMPERATURE, and SIGNAL simultaneously. A player who goes deeper is trading safety (oxygen, pressure, temperature) for progress (signal). Every decision about depth is a decision about all five systems at once.

This is the systemic payoff: a few rules, many interactions.

---

## Choosing the Right Artifact

| Situation | Artifact | Why |
|---|---|---|
| Starting a new project | Commitment artifact | Align the team before design begins |
| Designing a new mechanic | One-page design | Force clarity about inputs, outputs, relationships |
| Diagnosing depth problems | State-space map | Reveal isolated elements and overcoupled clusters |
| Communicating design to team | State-space map + one-pagers | Overview first, details second |
| Designing progression | Game loops | Ensure each loop is satisfying on its own terms |
| Diagnosing UX problems | Application state map | Find dead ends, missing paths, data loss points |
| Onboarding a new team member | Commitment artifact + state-space map | Context first, then structure |

For how one-page designs connect to systemic rule design, see the "Permissions, Restrictions, and Conditions" section in `systems-and-rules.md` if not already loaded. For how game loops relate to player motivation, see the "Player Motivation Models" section in `player-experience.md` if not already loaded.
