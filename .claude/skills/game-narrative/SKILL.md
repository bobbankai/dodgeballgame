---
name: "game-narrative"
summary: "Applied interactive storytelling: deduction systems, NPC agency, non-linear discovery"
type: "design"
description: "You MUST consult this skill when designing applied narrative mechanics — deduction systems, mystery design, non-linear story discovery, search-based storytelling, NPC agency, or interactive storytelling techniques. Also trigger when writing NPCs that feel alive, designing detective game loops, structuring player-driven revelation, or making story feel non-mechanical. NOT for diagnosing story-gameplay conflict at the system level (see game-design) or engine-specific implementation (see godot, love2d)."
---

# Game Narrative

Applied mechanics for interactive storytelling — how to design deduction systems, write NPCs with agency, and use player imagination as a narrative tool.

---

## Core Vocabulary

### Story Discovery

**Search-Based Narrative** — A story structure where the player discovers content by querying a database rather than following a linear path. The player's curiosity drives the search; the search curates a mini-narrative from the results. The story is assembled by the player, not delivered to them. *Her Story* is the canonical example: a word search against interview clips creates a personal, non-linear investigation.

**Player Imagination Gap** — The space between what the game shows and what the player infers. Non-linear or fragmented narrative forces the player to fill gaps with their own interpretation, making them a co-author. This gap is a feature, not a bug: a player who constructs meaning is more engaged than one who receives it. The iceberg principle applied to games — the story happening "off the page" is often richer than what's on it.

**Sculptural Narrative** — A story structure where the player explores a complete, pre-existing story from any entry point, assembling understanding non-linearly. Contrast with linear narrative (a path) or branching narrative (a tree). The player is a sculptor revealing a form, not a traveler following a road. Robustness requires that any fragment contain enough context to orient the player — achieved through character depth and thematic consistency, not guaranteed by the structure alone.

**Writing From the Character Out** — A writing discipline where scenes are written from the character's authentic headspace, not from the designer's structural needs. The character's agenda, voice, and psychology drive the scene; structural requirements are satisfied after the fact. Produces dialogue that feels alive rather than functional.

### Deduction Design

**Deduction Loop** — The core mechanic of detective games: discover a thing → think about the thing → prove to the game that you thought about it. The loop requires the player to demonstrate understanding through action, not just receive information. The "prove it" step is the interesting design space — it's a combination lock that requires comprehension, not just input.

**Deduction Space** — The full set of possible player actions that express understanding. Narrow deduction spaces (one correct action) create frustration when players know the answer but can't express it. Wide deduction spaces (many valid paths to truth) feel fair and reward creative thinking. Truth is broad — there is never only one way to arrive at a correct conclusion.

**Constructed Argument** — An alternative to the combination-lock deduction model. Instead of finding the single correct answer, the player builds a case: assembling evidence, testing it against a judge (NPC or system), and refining until the argument is watertight. The external judge creates space for the player to be wrong, refine, and improve — the loop is construct → test → revise, not construct → submit. Multiple valid arguments can reach the same conclusion.

**Two-Story Structure** — Every mystery has two stories: the story of the crime (what happened and why) and the story of the investigation (the detective and characters dealing with the aftermath). The crime story is the secret history being uncovered; the investigation story is the adventure the player is living. Both must be compelling. Most detective games over-invest in the crime story and under-invest in the investigation story.

**Burden of Proof** — The threshold of evidence the game requires before accepting a conclusion. Too low: players can brute-force solutions without understanding. Too high: players who understand the story can't express it. The ideal burden is calibrated so that a player who genuinely understands the situation can construct a convincing argument, while a player guessing randomly cannot.

### Quest Movement Patterns

**A-B-A (Return to Quest-Giver)** — Player departs from a hub, completes an objective elsewhere, and returns to the origin. Reinforces hub familiarity, NPC relationships, and the feeling of "reporting back." Works well for side quests, faction missions, and detective games where the hub is a character in itself. Risk: backtracking tedium if travel between A and B isn't interesting in its own right.

**A-B-C (Move Forward)** — Player departs and never returns; each location is new. Maintains momentum, rewards exploration, and makes the world feel larger. Works for main progression and journey narratives. Risk: players lose connection to NPCs left behind, and the world can feel disposable.

**A-B-C-A (Journey and Return)** — Full arc: departure, adventure, homecoming with new perspective. The return recontextualizes the origin. Works for act-level structure and coming-of-age stories.

Across all three patterns: *EarthBound* is exemplary hub-based A-B-A; *Outer Wilds* is pure A-B-C exploration; *The Witcher 3* uses hybrid structure with act-level A-B-C-A transitions.

Neither pattern is inherently superior — context determines which serves pacing. A game that is entirely A-B-A feels like a hub-and-spoke job board. A game that is entirely A-B-C feels like being pushed through a tunnel.

### Dialogue Craft

**Reactive Dialogue Rule** — A line triggered by a recent event must reveal something new about the character, situation, or world — or it must be cut. Confirmation lines (restating what just happened) add no information and train players to skip dialogue. The test is not "does this line make sense?" but "does this line earn its place?" Draft for pacing first; review for character-truth and value second.

### NPC Agency

**NPC Agency** — NPCs that pursue their own goals, hold their own opinions, and act independently of the player's wishes. An NPC with agency can refuse the player, lie to the player, or act in ways that complicate the player's goals — because the NPC has pressures and motivations the player doesn't fully control. Agency makes NPCs feel like people rather than quest dispensers.

**Entitlement Simulation** — A game designed to give the player exactly what they want, uncritically. The opposite of NPC agency. Entitlement simulation produces NPCs that exist only to serve the protagonist: they follow orders, their romances are skill checks, their problems exist to be solved by the player. Immersion fails because real relationships demand things of us.

**Protagonist Constraint** — Deliberately limiting what the protagonist can do to create space for NPCs to act. When the protagonist can solve every problem, NPCs become passive. When the protagonist's power is bounded by context (cultural outsider, wrong skill set, wrong social position), NPCs must act for themselves. Player agency is preserved through meaningful reaction and relationship, not through control.

---

## Problem → Concept Routing

| Problem | Concepts | What to Check |
|---|---|---|
| "My reactive dialogue feels redundant — characters just narrate what happened" | Reactive Dialogue Rule | Does each line reveal something new? Is it written from character headspace, not as a plot summary? |
| "My quest pacing feels off — either too much backtracking or players feel railroaded" | A-B-A, A-B-C, A-B-C-A | Is the movement pattern serving the story's emotional arc? Is A-B-A travel interesting, or is it pure chore? Does A-B-C leave players feeling disconnected from earlier NPCs? |
| "Players aren't engaging with my detective mechanic" | Deduction Loop, Deduction Space | Can players express what they know? Is the "prove it" step too narrow or too abstract? |
| "My mystery feels like a checklist, not a revelation" | Two-Story Structure, Constructed Argument | Is there an investigation story alongside the crime story? Is the solve a construction or a combination lock? |
| "Players brute-force my deduction puzzles" | Burden of Proof, Constructed Argument | Is the deduction space too narrow? Can players reach the answer without understanding? |
| "My NPCs feel like quest dispensers" | NPC Agency, Entitlement Simulation | Do NPCs have goals that conflict with the player's? Can they refuse, lie, or act independently? |
| "Players feel like they're just watching the story" | Player Imagination Gap, Search-Based Narrative | Is the player assembling meaning or receiving it? Where can gaps be opened for player inference? |
| "My non-linear story feels incoherent" | Sculptural Narrative, Writing From the Character Out | Does each fragment contain enough context to orient the player? Is the story written from character, not structure? |
| "My story feels mechanical — players can see the scaffolding" | Writing From the Character Out, Player Imagination Gap | Are scenes written from character headspace? Is structure imposed after the fact or before? |
| "My romance/relationship system feels transactional" | NPC Agency, Entitlement Simulation | Does the NPC have desires that conflict with the player's? Does the relationship continue after the "win state"? |
| "Players solve the mystery too fast / too slow" | Deduction Space, Burden of Proof | Is the deduction space calibrated? Can early discovery still reward deeper engagement? |
| "My world feels thin despite lots of lore" | NPC Agency, Protagonist Constraint | Do NPCs have contradictory opinions about the world? Does the protagonist's limited perspective force the player to construct their own understanding? |
| "My solve scene feels disconnected from the rest of the game" | Two-Story Structure, Constructed Argument | Does the accusation scene reflect the full range of states the player can arrive in? Is the high-agency phase feeding into the high-impact phase? |
| "My story branches but all paths feel the same" | Player Imagination Gap, NPC Agency | Are branches cosmetic or do they affect NPC behavior? Consider routing to `game-design` for depth analysis |

---

## Worked Examples

### Example 1: Designing a Deduction System That Doesn't Frustrate

**Scenario**: "Players understand the mystery but can't figure out how to tell the game they know."

This is a **Deduction Space** problem. The game has a narrow combination lock — one correct action — but players are arriving at correct conclusions through different reasoning paths.

Apply the **Constructed Argument** model: instead of one correct answer, design a scene where the player builds a case. In *Overboard* (inkle) — where the player is the murderer trying to avoid conviction — the accusation scene works topic-by-topic: each piece of evidence is introduced, discussed, and reaches a conclusion. The player can argue, lie, and redirect. A judge NPC weighs the accumulated outcomes — not a combination lock, but a ledger. Multiple paths reach the same verdict.

**Design checklist**:
1. Can the player reach a correct conclusion through more than one reasoning path?
2. Is there a "judge" (NPC or system) that evaluates the argument rather than checking a specific input?
3. Does the system reward understanding over brute-force enumeration?
4. Is there a fallback for ambiguous outcomes (e.g., "insufficient evidence — find more")?

---

### Example 2: Making a Non-Linear Story Feel Coherent

**Scenario**: "My search-based / non-linear story feels like random fragments, not a story."

This is a **Sculptural Narrative** and **Writing From the Character Out** problem. Fragments feel random when they're written to serve structure rather than character.

Sam Barlow's process for *Her Story*: write all scenes from the character's authentic headspace first, ignoring game structure. Then use data analysis to identify which clips are "low-scoring" (hard to discover) and revise them to add thematic resonance and searchable keywords — not to fix structure, but to make each clip earn its place thematically. The result: every clip contains the whole story in miniature. Any entry point orients the player.

**Design checklist**:
1. Does each fragment contain enough context to orient a player who encounters it first?
2. Is each fragment written from character headspace, not structural need?
3. Do fragments share thematic imagery that creates coherence across non-linear discovery?
4. Does early discovery of a key fact reward deeper engagement rather than ending the experience?

---

### Example 3: Writing NPCs That Feel Alive

**Scenario**: "My NPCs feel like they exist only to help the player."

This is an **Entitlement Simulation** problem. NPCs feel hollow when their only purpose is to serve the protagonist.

Apply **Protagonist Constraint** and **NPC Agency**: give NPCs goals that exist independently of the player, and limit the protagonist's ability to override them. In *80 Days*, Passepartout encounters an Aboriginal woman who refuses his help — not because the player hasn't unlocked the right dialogue option, but because her distrust of outsiders is a real constraint that no amount of protagonist effort can overcome. The player's agency is in how they react and what they understand, not in whether they can solve her problem.

**Design checklist**:
1. Does each NPC have at least one goal that doesn't involve helping the player?
2. Can NPCs refuse, lie, or act against the player's interests?
3. Is the protagonist's power bounded in ways that require NPCs to act for themselves?
4. Do NPCs have contradictory opinions about the world (rather than a single authoritative perspective)?
5. Is there content that belongs to the NPC — not for the player, not for the protagonist?

---

## Design Analysis Checklist

Run these questions when evaluating a narrative design:

**Discovery**: How does the player find story? Are they assembling meaning or receiving it? Where are the imagination gaps?

**Deduction**: Can players express what they understand? Is the deduction space wide enough for multiple valid approaches? Is the burden of proof calibrated?

**NPCs**: Do NPCs have independent goals? Can they act against the player? Does the protagonist's power leave room for NPC agency? Does any NPC bear the weight of representing an entire culture or background?

**Structure**: Is the story written from character headspace? Does each fragment contain enough context to orient the player? Does the story survive non-linear discovery? Does the quest movement pattern match the emotional arc?

**Revelation**: Is the climactic solve a construction or a combination lock? Does the investigation story (the adventure) hold up alongside the crime/secret story?

**Entitlement**: Are NPCs serving the player, or are they living their own lives? Does the game give the player exactly what they want, or does it demand something of them?

---

## References

| File | Contents | Read when... |
|---|---|---|
| `references/player-imagination.md` | Sam Barlow / *Her Story*: search-based narrative, sculptural story, writing from character out, balancing discovery | You're designing non-linear story discovery, search mechanics, or want to use player imagination as a narrative tool |
| `references/deduction-mechanics.md` | Jon Ingold / *Overboard*: deduction loops, combination lock problems, constructed argument model, two-story structure | You're designing a detective game, deduction system, or mystery climax |
| `references/npc-agency.md` | Meg Jayanth / *80 Days*: NPC agency, protagonist constraint, entitlement simulation, world-building through NPC perspective | You're writing NPCs, designing relationships, or want to move beyond the power fantasy |
| `references/dialogue-and-coherence.md` | Jonathan Blow: reactive-dialogue rule (lines must reveal something new or be cut), two-pass drafting (pacing then character-truth), coherence as buy-in mechanism, incoherent details cap emotional ceiling | You're writing moment-to-moment reactive dialogue, trimming lines that feel redundant or out-of-character, or diagnosing why players aren't investing in your world's fiction |
| `game-design/references/narrative-integration.md` | Ludo-narrative coherence theory, embedded vs emergent narrative, Player-Subject, DDE Three Journeys, interactive narrative structures, world-plot interface | You're diagnosing story-gameplay conflict, not designing narrative mechanics — "is my story fighting my gameplay?" |

---

## Relationship to Other Skills

**game-design** — Covers *why* narrative and gameplay must harmonize (ludo-narrative coherence, the Antagonist, Player-Subject). This skill covers *how* to design the narrative mechanics themselves. They co-trigger: game-design asks "is my story fighting my gameplay?"; this skill asks "how do I design a deduction system?" or "how do I write NPCs that feel alive?"

**godot / love2d** — Engine-specific implementation. This skill is engine-agnostic. When both fire, the engine skill handles concrete code; this skill handles narrative design reasoning.

**brainstorm** — Ideation process. This skill provides the domain vocabulary that brainstorm sessions draw on when working on narrative games.

**game-patterns** — Implementation patterns for game systems. When designing a deduction loop or NPC state machine, game-patterns provides the structural implementation vocabulary (State pattern, Observer for NPC reactions, Event Queue for evidence tracking).
