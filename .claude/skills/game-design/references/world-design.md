# World Design

First-principles thinking about persistent world design — what makes a virtual world feel real, how to design systems that create genuine immersion, and why copying previous games produces shallow worlds. Load this when designing persistent worlds, multiplayer spaces, or any game that needs to feel like a place rather than a game board.

---

## The First-Principles Advantage

**Source:** Richard Bartle, "MUD: Messrs Bartle and Trubshaw's Astonishing Contrivance" (GDC 2011). For spatial/level design principles, see the level-design skill (not yet available).

MUD was designed without precedent. Bartle and Trubshaw couldn't copy existing virtual worlds because none existed. This forced them to reason from first principles about what a virtual world should be and why.

The lesson: **if you start from an existing game and improve it 10%, you inherit all its assumptions — including the ones that were wrong.** Starting from first principles forces you to ask why things are the way they are, which reveals which conventions are load-bearing and which are just tradition.

**The design question to ask:** Not "what kind of game do I want to play?" but "what are the tools in my toolbox, and what can I enable with them?" Starting from player experience is premature — it assumes a player type before you've discovered what's possible to implement.

---

## The Immersion Principle

The human brain processes the world automatically. It recognizes patterns, infers physics, and builds models of how things behave. When something violates those models, the brain notices — and immersion breaks.

**The core rule:** If you have no reason not to conform to reality, conform to reality.

When the world behaves as expected, players don't have to consciously suspend disbelief — they just believe. Every unexplained inconsistency requires the player to either:
1. Assume it's a bug
2. Assume there's a hidden rule they don't understand
3. Accept that the world is arbitrary

Options 1 and 3 break immersion. Option 2 creates engagement — but only if the inconsistency is intentional and discoverable.

**Practical examples from MUD:**
- An icicle melts in a desert but not in a cold room
- Plate armor doesn't float
- Pouring 4 pints into a 3-pint glass leaves 1 pint on the floor
- Gunpowder explodes when exposed to fire — always, not just in specific contexts

These aren't complex systems. They're consistent applications of obvious physical rules. The complexity emerges from their interactions.

---

## Consistency as Emergence Engine

Consistent physics creates emergent gameplay that no designer anticipated. The MUD gunpowder example:

A player discovered a "safe room" accessible only by dropping a teleport object down a well. Another player put gunpowder in a boat, set it on fire, dropped it down the well, and killed the player in the "safe room" — using the river current, the fire spread, and the explosion mechanics that each existed independently.

This emergent behavior required no special code. It emerged from consistent rules applied uniformly.

**The anti-exploit argument:** Inconsistent physics creates exploits. Consistent physics creates emergent gameplay. When gunpowder only explodes in specific contexts (cannon, fire pit), players find the edge cases. When gunpowder always explodes when hot, the behavior is predictable and exploits are impossible — or become features.

---

## What to Abstract Away

Conforming to reality doesn't mean simulating everything. Some realistic behaviors should be abstracted because:

1. **They annoy players without adding gameplay** — carrying 10,000 gold pieces would be impossibly heavy; simulating encumbrance here adds friction without depth
2. **They're irrelevant to the experience** — bathroom breaks in movies only appear when something bad is about to happen; simulate what serves the game
3. **They break the fantasy** — some realism undermines the world you're trying to create

**The filter:** Does simulating this create interesting decisions or meaningful consequences? If yes, simulate it. If it's just friction or irrelevance, abstract it away.

---

## Designing Achievement Systems from First Principles

MUD needed a reason for players to engage beyond curiosity. Bartle evaluated multiple achievement structures:

- Equipment-based (more gear = higher status) — rejected for storage reasons, but also because it's consumerist
- Skill-based (practice improves specific abilities) — viable
- Level-based (experience points accumulate to level thresholds) — chosen
- Quest-based (linked objectives of increasing difficulty) — too structured
- Experience without levels (raw point accumulation) — viable but lacks social signaling

**Why levels won:** Not just because they provide intermediate goals and a sense of achievement — but because they created a **meritocracy**. In 1978 England, class, accent, and social background determined status. In MUD, only your own effort and skill determined your level. Levels were a political statement about what should determine status.

**The design lesson:** Know *why* you're using a mechanic, not just that it works. If you don't know why levels are in your game, you'll add more levels when you should be questioning whether levels are the right tool at all.

---

## The Simulation-vs-Previous-MMO Problem

Modern MMOs often simulate the previous MMO rather than reality. Conventions that made sense for technical or design reasons in 1990 get copied without understanding why they existed. The result: worlds that feel arbitrary because their rules are inherited rather than reasoned.

*Examples of inherited arbitrariness:*
- Enemies carrying weapons they don't use in combat
- Dyeable cloth armor but not plate
- Paint that only works on house walls, not other surfaces
- Enemies that don't react to nearby combat

None of these are hard to fix. They just haven't been questioned because the previous game did it this way.

**The question to ask of every inherited convention:** Why is this here? If the answer is "because the previous game had it," that's not a reason. Either find a real reason or remove it.

---

## Setting as Resonance and Dissonance

Bartle chose English folklore for MUD not because it was familiar, but because it provided the right balance of **resonance** (players know enough to feel oriented) and **dissonance** (players don't know enough to feel safe).

The goal: players should feel they know what kind of world they're in, but not know exactly what to expect. Familiar enough to engage, unfamiliar enough to explore.

**The setting design question:** Does this setting give players enough resonance to feel oriented, while maintaining enough dissonance to create genuine discovery?

*Bartle's shortlist included:* Three Musketeers France (rejected — poor female character options), Arabian Nights (excellent resonance, rich culture), Colditz escape (too depressing — success ended the game), Camelot (good symbolism, fixed time period), English mythology (chosen — continuous timeline usable as difficulty metaphor).

---

## Diagnostic Questions

- Does your world behave consistently? Can players predict what will happen based on observable rules?
- Where are you simulating the previous game instead of reasoning from first principles?
- What conventions have you inherited without questioning why they exist?
- Does your achievement system reflect what you actually want to say about status and progress?
- Does your setting provide the right balance of resonance (orientation) and dissonance (discovery)?

For how world consistency relates to systemic design, see `systems-and-rules.md` if not already loaded. For how setting resonance relates to player experience, see `player-experience.md` if not already loaded.
