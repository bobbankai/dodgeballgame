# Onboarding Design

Concrete techniques for making games teach themselves. Load this when designing how players learn your game, diagnosing early drop-off, or evaluating whether teaching is invisible enough.

---

## Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [Presentation as Trust Signal](#presentation-as-trust-signal)
3. [Structural Decisions](#structural-decisions)
4. [Runtime Techniques](#runtime-techniques)
5. [Writing Style](#writing-style)
6. [Anti-Patterns](#anti-patterns)
7. [Diagnostic Questions](#diagnostic-questions)

---

## Core Philosophy

### Invisible Onboarding

The best tutorial provokes "there was a tutorial?" from players. This is not achieved by hiding a tutorial — it's achieved by making the act of teaching indistinguishable from the act of playing.

The test: if you must label something "Tutorial," the onboarding has failed. The label signals that teaching has been separated from play. Once separated, it becomes skippable, ignorable, and resented. Players don't want to be taught; they want to play. The job of onboarding is to make those the same thing.

Invisible onboarding is achieved through structural decisions (economy design, mechanic pacing, level architecture) and runtime behaviors (adaptive hints, guided first actions). Structural decisions are more powerful because they shape the game itself — the teaching is baked into the design, not bolted on.

Distinct from Perceived Affordances (whether a thing *looks* like what it does) — Invisible Onboarding is whether the *act of teaching* is invisible. A game can have excellent affordances and still have a labeled tutorial that breaks immersion. Both layers matter independently.

### Investment Curve

Player willingness to absorb new information is proportional to their existing investment in the game.

At minute 1, tolerance for teaching is near-zero. Players don't know if they like the game yet. They haven't committed. Every second spent reading instructions is a second they're not playing, and a second closer to quitting. The game must be playable immediately — not after a tutorial, not after a cutscene, not after a loading screen with tips.

At level 45, a 3-minute tutorial for an optional mode is acceptable. The player has invested hours. They're committed. They want to understand the new system. The same tutorial that would kill retention at level 3 is welcome at level 45.

The investment curve governs *when* to introduce peripheral mechanics, complex stores, optional modes, and character-heavy exposition. The corollary: make the right action the most available action early on, because you cannot rely on the player understanding *why* it's right. Structure the game so correct behavior is the path of least resistance.

### Fun Prevails Over Perfect Teaching

When teaching and fun conflict, fun wins — but "fun wins" means *redesign the teaching moment*, not *abandon teaching*.

In Plants vs. Zombies (George Fan, GDC 2012), the shovel mechanic needed a tutorial. Fan tried multiple minigames to teach it: one had you dig up weeds (wrong lesson — taught "shovel removes bad things"), another had you remove walnuts to place peashooters (right lesson but not fun). Meanwhile, the team developed walnut bowling — a genuinely fun minigame that had nothing to do with the shovel. The compromise: prepend a brief structural moment ("use your shovel to dig up these three peashooters to prepare for bowling"), then let the player enjoy the fun minigame. The teaching survived, but the fun wasn't sacrificed to make the teaching more thorough.

This is the discipline: you don't get to sacrifice fun for the sake of a cleaner tutorial. But you also don't get to skip teaching because it's inconvenient. The answer is always redesign — find a teaching approach that's also fun, or attach a brief structural teaching moment to something that is.

---

## Presentation as Trust Signal

First-session (D1) presentation determines whether players ever reach deeper D30+ systems. A perfect engine in a broken chassis still fails.

Presentation isn't cosmetic — it's the trust signal that gates engagement. Players judge whether a game deserves their investment within seconds. Placeholder art, clunky UI, and generic effects communicate "not worth my time" regardless of underlying systems quality.

The asymmetry: good systems with bad presentation fail at D1 (players never discover the depth). Bad systems with good presentation fail at D30 (players discover the shallowness). Both fail, but only one gets played.

**Application**: Invest in first-impression polish proportional to how much your game relies on word-of-mouth or store-page conversion. The first 30 seconds must communicate the game's hook clearly.

---

## Structural Decisions

Techniques that shape the game itself — decisions made during design, not runtime behaviors. These are the most powerful onboarding tools because they make teaching inseparable from play.

### Economy as Guidance

Design the game's economy so the correct first action is the most natural first action — not because you told the player what to do, but because the numbers make it obvious.

In Plants vs. Zombies, George Fan changed the sunflower cost from 100 to 50 sun and the starting sun from 200 to 50. With the original values, players had enough sun to plant a peashooter immediately. With the new values, the first action is forced to be a sunflower — the player can't afford anything else. The game's flow naturally favors the right move without explicit instruction.

This required rebalancing the entire game. That's the commitment invisible onboarding demands: you don't add a tooltip that says "plant a sunflower first." You redesign the economy so planting a sunflower first is the only thing that makes sense. The teaching is structural.

**Application**: Audit your starting resources. Can a new player make the wrong first move? If yes, adjust costs, starting values, or available options so the correct move is the most available move.

### Mechanic Pacing

Introduce new mechanics at a rate the player can absorb. The pattern: introduce a mechanic on an easier level, then challenge the player with it on the next level. The first encounter is safe — the player can experiment without penalty. The second encounter is the real test.

In Plants vs. Zombies, George Fan introduced one new zombie type every other level. Each new zombie type required a new response. Players had time to understand the threat before it became dangerous. The game never introduced two new threats simultaneously.

Peripheral mechanics are delayed further. In PvZ (50 levels total):
- Shovel (remove plants): level 5 (~10% through)
- Money (coin collection): level 10 (~20% through)
- Store (purchasing): level 25 (~50% through)
- Zen Garden (optional mode): level 45 (~90% through)

These specific numbers are calibrated to PvZ's arc length and session structure. The generalizable principle is the *ratio*: introduce core tools early (first 10-20% of the arc), secondary systems in the middle (40-60%), and optional/complex modes near the end (80%+). A 2-hour game and a 40-hour game both follow this curve — the absolute timing differs but the investment proportion is the same.

Each delay is calibrated to the investment curve. By level 5, the player understands the core loop and can absorb a new tool. By level 45, the player is committed enough to engage with an entirely new mode.

**Application**: List every mechanic in your game. For each one, ask: when does the player first encounter it? Is that the right time? Could it be delayed until the player is more invested?

### Delayed Introduction

The investment curve in practice: delay anything that requires significant teaching until the player has earned the patience to receive it.

In-game stores are a useful example. Players who reach the store with earned currency will comparison-shop and read descriptions voluntarily. They're invested — they want to spend wisely. The same descriptions that would be ignored in a tutorial are read carefully when the player has something at stake.

Character introductions follow the same logic. In Plants vs. Zombies, Crazy Dave (the game's eccentric guide character) was delayed until level 6. His personality required introduction dialogue that made the early tutorial less direct. The delay meant players were already engaged when he appeared — his quirks were charming rather than obstructive.

**Application**: Identify every moment where you introduce a character, store, or optional system. Ask: is the player invested enough to care? If not, delay.

### Visual Self-Documentation

Two rules from Plants vs. Zombies (George Fan, GDC 2012):

**Rule 1**: You should know what something does by looking at it.
**Rule 2**: If not, you should know after seeing it act once.

Examples from PvZ:
- Peashooter: the spout communicates "this shoots things"
- Screen door zombie: the shield looks like a shield — it communicates "this blocks projectiles"
- Repeater: fires volleys of 2 peas, communicating 2x damage through visual repetition

The goal is affordances so clear that the first encounter teaches the rule. A player who sees the screen door zombie's shield and loses a pea to it understands the mechanic without a tooltip.

Cross-reference: See **Perceived Affordances** in SKILL.md for the broader principle. Visual Self-Documentation is the application of Perceived Affordances to onboarding — designing affordances specifically to eliminate the need for explanation.

**Application**: For each entity or mechanic, ask: does it look like what it does? If not, can you redesign the visual to communicate the behavior? If not, can you ensure the first encounter teaches the rule through consequence?

### Level Architecture as Tutorial

Some of the most effective onboarding is built into level design itself, with no runtime teaching at all.

**Super Mario Bros. World 1-1**: The level structure forces the player to discover jumping, enemy stomping, and power-ups through environmental design. The first Goomba appears at a distance, giving the player time to react. The first mushroom rolls toward Mario, making it easy to collect accidentally. The first gap requires a jump. No text. No tutorial. The level IS the tutorial.

**Portal's test chambers**: Each chamber introduces one new concept before combining concepts in later chambers. Early chambers teach portal traversal in isolation. Later chambers introduce momentum conservation through portals. The final chambers combine traversal and momentum. The complexity builds incrementally — players are never asked to combine concepts they haven't practiced separately.

**Celeste's Assist Mode**: Structural adaptive difficulty — the game adapts to player need without framing it as "easy mode." Players who need help can slow time, add air dashes, or enable invincibility. The mode is accessible through the Options menu and openly promoted by the developers as an accessibility feature without shame. Players who use it feel helped, not patronized. The design lesson is that accessibility features should be *available without being pushed* — opt-in, non-judgmental, and destigmatized rather than hidden or foregrounded.

**Application**: Before adding any runtime hint or tooltip, ask: can this be taught through level design? Can the level structure force the player to discover the rule?

---

## Runtime Techniques

In-game teaching behaviors — things that happen during play, after structural decisions have been made.

### Do It Once

Get the player to perform the action once and they understand it. Don't explain — guide.

In Plants vs. Zombies (George Fan, GDC 2012):
- The first coin gets a bouncy arrow pointing to it — the player clicks it once and understands coins are clickable
- The seed packet flashes when the player needs to plant — the flash guides without explaining
- The grass highlights after picking up a seed packet — the player sees where to plant

The technique: flash a button, point an arrow, highlight the target. The player performs the action. They understand. No text required.

**Application**: For each action you need to teach, ask: can you guide the player to perform it once without explaining it? A visual cue that leads to a successful action teaches more than a paragraph of text.

### Adaptive Messaging

Show hints only to players who demonstrate they need them. Players who figure things out on their own feel smart. Players who struggle get increasing help. Neither group is patronized.

In Plants vs. Zombies (George Fan, GDC 2012): "Plant peashooters to the left" is only shown if a peashooter dies in the rightmost columns. The hint is triggered by demonstrated failure, not by a timer or level number.

The Insaniquarium carnivore example (also George Fan): a carnivore fish that eats other fish.
- First death: "Warning" — the player is alerted something went wrong
- Second death: "Hint: carnivores won't eat fish food" — the player gets a clue
- Third death: flat-out tells the player what to do

Players who figure it out early never see the second or third message. Players who don't get escalating help. The system respects player intelligence while ensuring no one is left behind.

**Application**: For each mechanic that players commonly fail to understand, define a trigger condition (a specific failure state) and an escalating message sequence. Show nothing until the trigger fires.

### Unobtrusive Messaging

When text is unavoidable, display it passively — don't freeze the action or demand acknowledgment.

In Plants vs. Zombies (George Fan, GDC 2012): messages appear at the bottom of the screen. The game continues. The player can read or ignore. No "OK" button required.

Side-scroller example: "Press Z to jump" written on a background wall that scrolls naturally past the player. The instruction is part of the world, not an interruption of it.

**Application**: If you must show text, ask: does this require the player to stop? If yes, can it be displayed passively instead? Can it be part of the environment rather than a UI overlay?

---

## Writing Style

For the text that survives subtractive design — the hints, descriptions, and tooltips that remain after you've eliminated everything you can.

### Sophisticated Caveman

Get ideas across in as few words as possible. Not unsophisticated — doesn't replace "I" with "Me" — but favors brevity above all else.

Target: 8 words or fewer on screen at any moment. One sentence per concept.

PvZ plant descriptions (George Fan, GDC 2012):
- "Gives you additional Sun"
- "Blows up all zombies in an area"
- "Shoots fumes that can pass through screen doors"

Each description communicates the ONE most important thing to know. Not the second most important thing. Not a qualification. The one thing.

**Application**: For each piece of text in your game, ask: what is the one most important thing this communicates? Cut everything else. If you can't cut it to 8 words, ask whether the remaining words are all load-bearing.

### Chunked Dialogue

When more text is unavoidable, break it into small pieces the player forwards through one click at a time. Never present a wall of text.

Old Nintendo games did this naturally due to pixel constraints — the screen could only hold a few words. The constraint produced better writing. Impose the constraint deliberately.

**Application**: If a dialogue sequence has more than 2-3 sentences, break it into separate screens. Each screen should contain one idea.

### Trust Economy

Every irrelevant message erodes willingness to read the next one. Every relevant message builds trust.

If you show players a message about a mechanic they won't encounter for 30 minutes, they learn that your messages aren't worth reading. The next message — the important one — gets ignored. You've trained them to tune out.

Don't cry wolf. Show messages only when they're immediately relevant. The player's attention is a finite resource. Every message you show is a withdrawal from that resource. Make sure the withdrawal is worth it.

**Application**: For each message in your game, ask: is this immediately relevant to what the player is doing right now? If not, delay it until it is.

### Delay Character Introductions

Characters who require introduction dialogue add friction before the player is invested. Delay them until the player is engaged enough to care.

In Plants vs. Zombies, Crazy Dave was delayed until level 6. His personality required introduction dialogue that made the early tutorial less direct. By level 6, players were invested — his quirks were charming rather than obstructive. At level 1, the same dialogue would have been an obstacle.

**Application**: If a character must speak before the player is invested, ask: can the character be delayed? Can the character's first appearance be wordless? Can the introduction be earned rather than imposed?

---

## Anti-Patterns

Patterns that signal onboarding has failed.

**Labeled Tutorials** — "Tutorial 1 of 6." The virtual equivalent of a dry instruction manual. The label separates teaching from playing. Once separated, the tutorial becomes something to endure rather than something to experience. If you find yourself numbering tutorials, the onboarding is broken at the structural level.

**Front-Loaded Info Dumps** — Explaining mechanics the player won't encounter for 30 minutes. Violates the investment curve and the trust economy simultaneously. Players don't retain information they can't immediately apply, and they learn that your messages aren't worth reading.

**Attention Noise** — Achievements triggering during teaching moments. Cluttered UI competing for focus. Notifications appearing while the player is trying to learn. Every competing stimulus during a teaching moment reduces the probability the lesson lands.

**Separating Tutorial from Game** — A main menu with "Play" and "Tutorial" as separate options. This is the structural version of the labeled tutorial anti-pattern. Players who skip the tutorial miss the teaching. Players who complete the tutorial then have to mentally bridge from tutorial-mode to game-mode. The separation guarantees some players will be lost.

**Explaining Before Doing** — Telling the player what a mechanic does before they've encountered it. The explanation has no context. It won't be retained. Wait until the player is about to encounter the mechanic, then guide them through it.

---

## Diagnostic Questions

Quick checklist for evaluating onboarding quality. Work through these before adding any runtime hints or tooltips.

**Structural:**
- Could a player reach minute 5 without reading a single word? If not, can you redesign so they can?
- Is there any moment where a labeled "tutorial" indicator appears?
- Does the game's economy/structure naturally guide the player toward correct behavior without explanation?
- Could any mechanic introduction be delayed until the player is more invested?
- Is the tutorial separated from the game (separate menu option, separate mode)?

**Runtime:**
- For each mechanic introduction: is the player doing or reading?
- Are messages shown only when the player has demonstrated they need them?
- Is there attention competition at any moment during teaching (achievements, notifications, cluttered UI)?
- Does any message appear before the player will immediately encounter the mechanic it describes?

**Writing:**
- Is each piece of text 8 words or fewer?
- Does each message communicate exactly one concept?
- Has every message earned its place — is it immediately relevant to what the player is doing?
- Are character introductions delayed until the player is invested?

**The ultimate test**: Playtest with someone who has never seen the game. Watch without explaining anything. Note every moment they hesitate, ask a question, or make the wrong move. Each of those moments is an onboarding failure. Fix them structurally before adding text.

---

For the underlying principles (Play > Show > Tell hierarchy, Notion Physics), see the "Communicating Rules to Players" section in `player-experience.md` if not already loaded. For economy design and resource systems that support structural onboarding, see `balance-and-competition.md` if not already loaded.
