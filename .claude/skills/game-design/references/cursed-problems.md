# Cursed Problems in Game Design

Problems that have no good solution — only least-bad tradeoffs. Load this when a design tension feels fundamental and unsolvable, or when iterating on a problem produces no satisfying answer.

---

## What Is a Cursed Problem?

**Source:** Alex Jaffe, "Cursed Problems in Game Design" (GDC 2019).


A **cursed problem** is an unsolvable design problem rooted in a conflict between core player promises.

**Player promises** are the essential experiences the game implicitly or explicitly guarantees. They live in the designer's heart (what you care about making) and in the player's heart (what they believe the game owes them after a few minutes of play).

A cursed problem arises when two promises are fundamentally incompatible — not just hard to satisfy simultaneously, but logically contradictory. No amount of tuning, content, or iteration resolves the conflict.

**The test for cursedness:** Can you make a small change to the game that removes the tension without changing the core premise? If yes, it's a hard problem, not a cursed one. If every fix requires giving up something the game fundamentally promises, it's cursed.

---

## Canonical Cursed Problems

### Free-for-All Politics
**Promises in conflict:** "This game rewards combat mastery" vs. "Playing to win is the goal."

In any free-for-all competitive game, the optimal strategy is political — gang up on the leader, form alliances, betray at the right moment. But political play is incompatible with combat mastery being the primary skill. The game you thought you were making becomes a social negotiation game.

### The Quarterbacking Problem
**Promises in conflict:** "Cooperative play means everyone contributes independently" vs. "We're optimizing to win."

In turn-based co-op games, centralized decision-making is almost always optimal. One player who sees the whole board will naturally take over, reducing everyone else to executing their instructions. The Ocean's Eleven fantasy of interdependent specialists conflicts with the strategic reality.

### Skill Inflation
**Promises in conflict:** "Long journey of mastery" vs. "Stable, vibrant community."

Evergreen competitive games naturally see their player base skill up over time. Veterans get better; newcomers face an impossible gap. A long mastery journey requires a rising skill pool; a healthy community requires a broad range of skill levels. These don't coexist.

### Commodified Reward
**Promises in conflict:** "Loot drops are exciting and varied" vs. "A marketplace lets me trade efficiently."

An efficient trading market makes every item fungible — worth only its auction house price. This destroys the moment of discovery (what's in this drop?) that makes loot games compelling. The Diablo 3 auction house is the canonical example.

### Quantified Creativity
**Promises in conflict:** "Express yourself freely" vs. "Progress your character."

Extrinsic goals (progression, leveling, winning) tend to subsume intrinsic goals (creative expression). Once a game signals that progression is the point, players follow that signal even if it crowds out what initially attracted them.

### Life Disruption (Location-Based Games)
**Promises in conflict:** "The game overlays your real life, available anywhere" vs. "Personal safety and mindfulness."

A location-based game that rewards play at specific times and places conflicts with the basic expectation that games don't endanger players. Any fix that limits when/where the game is playable weakens the first promise.

---

## The Four Techniques (Sacrificial Responses)

When you identify a cursed problem, you cannot solve it. You can only choose which promise to sacrifice, and how much. Four categories of sacrifice:

### 1. Barriers
Cut affordances that allow the promise-breaking behavior. Make the problematic action impossible.

*Example:* Battle royale games address free-for-all politics by spreading players far apart with high lethality. Political coordination becomes impractical. **Sacrifice:** Some of the PvP control fantasy — you can't dominate a specific opponent.

### 2. Gates
Make the promise-breaking behavior difficult rather than impossible. Add friction.

*Example:* Hiding player scores in a brawler makes it harder to identify who to gang up on. **Sacrifice:** The tension of knowing exactly who's winning.

### 3. Carrots
Change the objective that's pulling players through the problematic behavior. Create new goals that route around the conflict.

*Example:* Tournament scoring based on individual performance (not just winning) reduces the incentive for political play. **Sacrifice:** The clarity of a single win/lose outcome.

### 4. S'mores (Lean In)
Accept that players will engage in the "problematic" behavior and make it genuinely fun. Reframe the promise so the behavior is the game.

*Example:* Diplomacy leans fully into political play — it's the entire game. **Sacrifice:** Moment-to-moment action skill.

*Example:* Super Smash Bros. (party mode) weakens both the combat mastery and play-to-win promises, making chaos and randomness part of the appeal.

---

## Distinguishing Cursed from Hard

Not every painful design problem is cursed. A problem is **hard** (not cursed) if:
- It can be solved with enough work, iteration, or content
- A small change to mechanics or content removes the tension
- The promises are compatible in principle, just difficult to satisfy simultaneously

A problem is **cursed** if:
- Every fix requires giving up a core promise
- The tension is structural, not tunable
- The promises are logically incompatible

*No Man's Sky's "millions of worlds + vibrant ecosystems" was hard, not cursed — a major update delivered on both. The Diablo 3 auction house was cursed — no tuning could make efficient trading compatible with exciting loot discovery.*

---

## Using Cursed Problems Proactively

Cursed problems are also **opportunity spaces**. Because most designers avoid them as unsolvable, the design territory around them is underexplored. Identifying a cursed problem and deliberately choosing a sacrifice opens a whole new design direction.

*Challenges worth exploring:* multiplayer games with player-generated content that stays balanced; PvP games where all players feel the outcome was just; games that maintain mystery in the age of wikis.

---

## Diagnostic Questions

- What are the two (or more) promises this design is making?
- Are they compatible in principle, or logically contradictory?
- If I fix the tension, which promise am I weakening?
- Which of the four techniques (barrier, gate, carrot, s'mores) am I using?
- Am I wandering the desert looking for a solution that doesn't exist?

For balance-related tensions, see `balance-and-competition.md` if not already loaded. For narrative promise conflicts, see `narrative-integration.md` if not already loaded.
