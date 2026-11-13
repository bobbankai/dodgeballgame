# Choice Architecture and Option Presentation

Applied cognitive science for structuring player choices — how many options to present, how to frame them, and how to make decisions feel satisfying. Load this when deciding how many options to offer at a choice point, diagnosing why choices feel overwhelming or unsatisfying, or designing systems where players select from a set.

---

## Table of Contents

1. [The Decoy Effect](#the-decoy-effect)
2. [Option Count Thresholds](#option-count-thresholds)
3. [Player Heuristics](#player-heuristics)
4. [Compression Techniques](#compression-techniques)
5. [Worked Example: Slay the Spire's Card Draft](#worked-example-slay-the-spires-card-draft)
6. [Worked Example: Magic: The Gathering Draft](#worked-example-magic-the-gathering-draft)
7. [Diagnostic Questions](#diagnostic-questions)

---

## The Decoy Effect

**Source:** Huber, Payne, & Puto (1982). "Adding Asymmetrically Dominated Alternatives." Popularized by Dan Ariely in *Predictably Irrational* (2008).

The decoy effect (also called the attraction effect or asymmetric dominance effect) occurs when adding a third option that is clearly inferior to one alternative but only partially inferior to the other shifts preference toward the dominating option. The brain doesn't evaluate options in isolation — it judges by comparison.

### Formal Conditions

The effect works when:
- The player is near indifference between the two real options (if one is obviously better, the decoy adds nothing)
- Both evaluation dimensions matter roughly equally to the player
- The decoy's inferiority is easy to perceive at a glance
- The decoy isn't so undesirable that it signals poor curation

**Example (from Ariely):** The Economist offered three subscriptions: web-only ($59), print-only ($125), and print+web ($125). Nobody chose print-only — but its presence caused 84% to choose print+web. When print-only was removed, preference for print+web dropped to 32%. The dominated option changed nothing about the real choices but dramatically shifted how satisfying the winning choice felt.

### Contextual Decoys in Games

A decoy doesn't need to be universally bad — it only needs to be bad *in this specific choice*. This distinction is critical for game design. Players resent options that are always worthless ("why did they even put this in the game?"), but they accept options that are wrong *for them right now*.

Techniques for creating contextual decoys without universally bad content:

- **Archetype commitment**: Once a player commits to a build (goblin deck, poison build, melee class), cards/boons/items from other archetypes become contextual decoys. The content is inherently valid; it's just wrong for this player's current strategy.
- **Rarity variation**: Offering options at different rarity tiers (Hades' boon system). A common-tier version of a good boon feels like a decoy against a rare-tier alternative — but players know the common version can appear at higher rarity in future runs.
- **Random upgrades**: Attaching random modifiers to options (Legends of Runeterra, Monster Train 2). The same card with a weak random upgrade is a contextual decoy against the same card with a strong one. Players don't feel the base card is bad — just this instance.
- **Slot weighting**: Boosting the quality of 2 out of 3 slots behind the scenes. Players experience this as "I got lucky with two of my options" rather than "one option was designed to be bad."

### The Satisfaction Mechanism

Why the decoy works psychologically: humans experience opportunity cost as loss. Choosing between two good options means mourning the one you didn't take. But choosing between two good options and one obviously-wrong option lets you feel *smart* for rejecting the bad one, which reduces the sting of passing on the other good option. The bad option serves as a reference point that makes your final choice feel more clearly correct.

---

## Option Count Thresholds

The number of simultaneous options a game presents is a design decision with cognitive consequences. Different counts produce different player experiences, grounded in perceptual and memory limits.

### The Subitizing Range (1-4)

**Source:** Kaufman et al. (1949). "The discrimination of visual number." Confirmed across visual, tactile, and auditory perception.

**Subitizing** is the instant, effortless perception of quantity without counting. Humans perceive 1-4 items as a gestalt — no enumeration required. At 5+, response time jumps by 250-350ms per additional item as the brain switches from pattern recognition to sequential counting.

**Game design implication**: Options within the subitizing range (1-4) are perceived as a complete set instantly. The player's cognitive effort goes entirely toward *evaluating* the options, not toward *enumerating* them. This is why 3 feels natural — the brain never has to count.

### The Thresholds

| Count | Cognitive Basis | Design Use | Examples |
|---|---|---|---|
| **2** | Binary contrast; no decoy possible | Thematic choices (good/evil), bundled uncertain outcomes, high-stakes commitment | Reigns (swipe left/right), binary dialogue choices |
| **3** | Minimum for decoy pattern; within subitizing range; minimum to establish-then-break a pattern | Standard "pick one" with satisfying decision feel | Slay the Spire card draft, Hades boon picks, roguelike level-up rewards |
| **4** | Minimum for "pick multiple" with decoy support | Pick-2-of-4 scenarios where you want an interesting final selection after eliminating the decoy | Draft modes where you select a subset |
| **5** | Working memory ceiling for comfortable simultaneous evaluation (Miller's 7±2, but 5 is the conservative bound) | Shops, mission lists, talent trees where each option has significant opportunity cost | Slay the Spire shop (cards + relics + removal), quest boards |
| **8+** | Exceeds short-term memory; by the time you read the 8th, you've lost track of the 1st-2nd | Creating the *feeling* of boundless possibility; the set feels larger than the player can hold | Open world quest logs, character class selection, Skyrim's skill trees |

### Time Pressure Halves the Budget

The 5-7 comfortable evaluation range assumes no time pressure and no multitasking. Adding a timer, real-time threats, or concurrent tasks cuts the effective budget roughly in half. A 3-option choice under time pressure is comfortable; a 5-option choice under time pressure produces analysis paralysis.

---

## Player Heuristics

When options exceed comfortable evaluation, players develop mental shortcuts — **heuristics** — to reduce the effective decision space. This isn't laziness; it's cognitive necessity. Designers can either support heuristic development (making the game learnable and satisfying) or ignore it (forcing players to invent their own coping strategies with no guidance).

### Types of Player Heuristics

**Directional heuristics** tell you what to do: "always take the rare card," "prioritize removal," "if in doubt, pick damage." These reduce a complex evaluation to a simple rule. New players need directional heuristics to avoid paralysis; experts use them as defaults they override in specific situations.

**Positional heuristics** tell you who's winning: "the player with the most territory is ahead," "if they have 3 relics, they're probably snowballing." These inform directional decisions by providing context about game state.

### Designing for Heuristic Development

- **Rarity signals**: Labeling options as Common/Rare/Epic gives new players an instant directional heuristic ("rare is probably better"). Experts learn when to override it, which is itself a form of depth.
- **Archetype systems**: Once a player commits to a build, they can categorically eliminate options outside their archetype. A 15-card pack becomes a 7-card evaluation. The game's structure does the cognitive work of narrowing the field.
- **Clear value indicators**: Explicit stats, star ratings, or tier labels let players form quick hypotheses. Even if the heuristic ("higher stats = better") is sometimes wrong, it provides a scaffold for learning when it's right.
- **Progressive reveal**: Show the most relevant information first. A card's energy cost and primary effect should be readable faster than its synergy text, because energy cost enables the first-pass heuristic ("can I afford this?").

The principle: players *will* develop shortcuts. Design the system so that the shortcuts they develop are approximately correct and lead them toward deeper understanding over time.

---

## Compression Techniques

**Compression** is managing perceived complexity so that a choice feels simpler than its actual option count. The player's experience of "how many things am I choosing between" is manipulable through framing, grouping, and information architecture.

### Information Proximity

Minimize the distance a player's eyes must travel to gather decision-critical information. For each choice, identify the minimum information needed to evaluate it and put that information on (or adjacent to) the choice itself.

**Example (from Dan Felder, on Warhammer Quest redesign):** The original card read "when any goblin attacks, they deal 1 extra damage" — requiring the player to remember this card exists when looking at other goblins. The redesign: "when I attack, I deal +1 damage for each goblin on the field." Now the rule only matters when you're already looking at this card (to turn it sideways for its attack). The cognitive load of tracking the rule dropped to near-zero.

**Principle**: Effects should matter when you're already looking at them. Every effect that matters when you're *not* looking at it consumes working memory — a finite resource that competes with strategic thinking.

### Perceived vs Actual Option Count

UI framing changes how many options the player *feels* they're evaluating:

- **Grouping**: Organizing 8 items into 2 groups of 4 feels like "two categories" rather than "eight things." The player makes a category-level decision first, then evaluates within the chosen category.
- **Null option**: Many pick-1-of-3 systems also have "skip" and "reroll" available. These are real options, but the UI frames them as meta-actions rather than peers of the three main choices. Five actual options feel like three-plus-controls.
- **Sequential narrowing**: Presenting choices in stages (first pick a category, then pick within it) converts one large decision into multiple small decisions. A 20-option shop becomes a 4-category choice followed by a 5-option choice.

### Working Memory as Design Resource

Working memory holds roughly 4±1 "chunks" of active information. Every game element the player must track — enemy positions, cooldown timers, resource counts, pending effects — competes for this budget. Choice architecture that assumes full working memory availability (e.g., evaluating 5 options while also tracking 3 enemy timers and a resource bar) will produce worse decisions and less satisfaction than the option count alone would predict.

Design implication: the "right" number of options depends on what *else* the player is tracking at that moment. A 5-option shop between encounters (no concurrent demands) is comfortable. A 5-option ability wheel during real-time combat (high concurrent demands) is overwhelming.

---

## Worked Example: Slay the Spire's Card Draft

Slay the Spire's post-combat card reward is the canonical modern example of 3-option choice architecture. After each fight, the player picks one of three cards (or skips).

### Why 3 Works Here

- **Subitizable**: The player perceives all three cards simultaneously without enumeration. Cognitive effort goes entirely to evaluation.
- **Decoy pattern emerges naturally**: Once committed to a build (e.g., Strength-scaling), cards from other archetypes (e.g., Poison) become contextual decoys. The player feels good about rejecting them — confirmation that their strategy has identity.
- **Fast decision cadence**: Post-combat choices happen every 2-3 minutes. Three options keeps each decision fast (~10 seconds for experienced players), maintaining the game's pacing.
- **Rarity as heuristic**: Rare cards are highlighted with a gold border. New players can default to "take the rare" as a first heuristic. Experienced players learn when to override (a common that synergizes perfectly may be better than a rare that doesn't fit).

### Contrast: The Shop (5-7 Options)

The same game uses a different option count for a different purpose. The shop presents ~7 cards plus relics, potions, and card removal — well above the comfortable draft count.

This works because the context is different:
- **No time pressure**: The player can browse indefinitely between floors.
- **Resource gating**: Gold cost means most options are irrelevant (too expensive), naturally filtering the effective choice set down to 2-3 affordable items.
- **No opportunity cost between categories**: Buying a potion doesn't prevent you from buying a card. The 7+ options decompose into independent sub-decisions.

The design lesson: the same game uses 3 when it wants fast, satisfying identity-forming decisions, and 7+ when it wants deliberate optimization under resource constraints.

---

## Worked Example: Magic: The Gathering Draft

MTG draft presents 15 cards per pack — far above the comfortable evaluation range. This is a case study in what happens when option count exceeds cognitive capacity, and how game structure supports player-developed heuristics.

### The Overload Problem

Fifteen cards cannot be simultaneously evaluated. By the time a player reads card 8, they've lost track of cards 1-2. The first few picks of a draft (before color commitment) are the hardest because the full 15 are potentially relevant. New drafters often stall on pick 1 — classic analysis paralysis.

### How Players Cope: Self-Imposed Filters

Players develop heuristics that reduce 15 effective options to a manageable number:

1. **Color commitment** (structural filter): After picks 1-3, committing to two colors eliminates roughly half the pack's contents. Fifteen cards becomes 7-8 on-color cards.
2. **BREAD** (directional heuristic): Bombs, Removal, Evasion, Aggro, Defense. A priority ordering that tells new players what to look for first, enabling them to scan rather than evaluate exhaustively.
3. **Signal reading** (positional heuristic): Noticing what colors/archetypes are being passed by neighbors. This narrows the "correct" options further — "red is open" means red cards jump in priority without re-evaluating each one on its merits.
4. **Rarity quick-scan** (perceptual shortcut): Check the rare slot first. If it's a bomb, evaluation is done in 2 seconds regardless of what else is in the pack.

### The Design Lesson

MTG draft works *despite* exceeding cognitive limits because the game provides structural scaffolding for heuristic development. Color identity creates categorical filters. Rarity signals provide quick-scan entry points. Sequential information (what was passed to you) narrows the space over time. The game doesn't present 15 equivalent options — it presents 15 options with enough structure that players quickly develop strategies for ignoring most of them.

The cautionary lesson: if your game presents 8+ options without structural support for heuristic development, players will either develop crude heuristics (ignoring potentially good options) or experience paralysis. Either outcome means the extra options aren't adding depth — they're adding confusion.

---

## Diagnostic Questions

**Option count:**
- How many options are presented simultaneously? Is this within the subitizing range (1-4), the comfortable evaluation range (5-7), or above it (8+)?
- Is there concurrent cognitive load (real-time threats, resource tracking, multiplayer reads) that reduces the effective budget?
- If above 5, what structural support exists for players to narrow the field? (Archetype filters, rarity signals, resource gating, categorical grouping)

**Decoy presence:**
- In a typical choice, is there at least one option that is contextually inferior? (Not universally bad — just wrong for this player's current state)
- Is the decoy's inferiority perceivable at a glance? (If it requires deep analysis to see why it's worse, it doesn't produce satisfaction)
- Are players feeling good about their picks, or experiencing regret? (Regret often signals missing decoys — all options feel roughly equal, so any choice means mourning the alternative)

**Heuristic support:**
- Can a new player form a first-pass heuristic within 3 picks? (Rarity, archetype labels, clear stat advantages)
- Do experienced players have reasons to override the simple heuristic? (This is where depth lives — the heuristic is approximately right but not always right)
- Are players developing accurate heuristics, or are they developing wrong ones that the game's structure encourages? (If the obvious heuristic is wrong, the affordances are misleading)

**Information architecture:**
- How far must the player's eyes travel to gather decision-critical information?
- Do effects trigger when you're looking at them, or when you're looking elsewhere?
- Could UI grouping, sequential narrowing, or resource gating reduce the perceived option count without removing actual options?

For how choice architecture interacts with depth analysis, see the "Depth vs Complexity" section in `depth-and-dynamics.md`. For how option presentation relates to player motivation, see the "Player Motivation Models" section in `player-experience.md`. For how feedback loops interact with choice satisfaction, see the "Slippery Slope and Feedback Loops" section in `balance-and-competition.md`.
