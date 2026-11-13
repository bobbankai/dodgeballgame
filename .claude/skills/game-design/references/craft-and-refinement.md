# Craft and Refinement

Covers the craft disciplines that separate a shipped game from a good one — first-impression friction, difficulty calibration, mechanic depth, contrivance cost, production value, input feel, design process, and evaluation lenses. Load this when a game's opening isn't landing, a mechanic feels exhausted or shallow, difficulty is calibrated wrong, or you need a process check on whether you're building the right thing.

*Synthesized from [Jonathan Blow stream clips](https://www.youtube.com/@JBH-p5b) — full per-topic sources in [docs/sources/jonathan-blow.md](../../docs/sources/jonathan-blow.md).*

---

## Openings and First Impressions

First impressions form before the title screen. The player's tolerance for friction is near-zero at the start; every second of non-play is a withdrawal from an account that hasn't been funded yet.

**Friction budget.** Minimize pre-gameplay friction: get to player agency fast. Never wrest control from the player during the opening — especially the camera. The camera is the player's eyes; seizing it signals that the designer's vision matters more than the player's experience.

**Restart speed.** Fast restart makes harsh difficulty tolerable; slow respawn multiplies frustration. The death-to-retry interval is part of the difficulty design, not a production detail.

**Legibility from the first interaction.** Mechanics must be legible and feedback must be consistent from the very first interaction. Progression must be *perceptible* — if players can't see themselves improving, they disengage. Jonathan Blow argues that "tuning for babies kills interest," but difficulty is a deliberate choice, not a baseline; the designer must decide, not default.

**Don't excuse a weak core.** Early-access status, tech-demo pride, or making "skip the game" an explicit feature are not substitutes for a working core. Jonathan Blow argues that early access is no excuse for a game that isn't ready to be played.

**Anti-metroiding.** Don't front-load every ability then strip it. Start a little later, hand over one *interesting* ability. If the first ability isn't interesting alone, pick another or question the design. A game that opens by granting and then removing power teaches the player that their agency is illusory.

**Commit to the core.** Telegraph "bait" setups, avoid levels that play themselves (one forced path), and commit hard to the core mechanic. An authentic, specific aesthetic beats an overused "fake glitch" look as a first-impression signal.

---

## Difficulty Is Not Quality

Jonathan Blow argues that "good" is at least orthogonal to "difficult" — anyone can make things hard; the designer's job is an operative theory of *good*.

A higher skill ceiling is not automatically a better game. The pinky-toe thought experiment: requiring players to use only their pinky toe raises difficulty and lowers quality. The ceiling and the quality are independent axes.

**The exchange rate.** Judge a game by the exchange rate between what it demands and what it returns. Difficulty must be "paid back" with interesting situations. Jonathan Blow cites Super Meat Boy as a game that earns its difficulty: the situations it creates are genuinely interesting, and the fast restart means the cost of failure is low. Making things hard is easy; making them *feel good* is the real work.

**Consequence and stakes.** The possibility of failure is central to engagement. Jonathan Blow argues that "player can't fail" mechanics trivialize stakes and are often lazy design. A mechanic with no consequence goes unregistered by players — they pass through it without forming a memory. There must be an actual challenge beneath the activity.

---

## Mining a Mechanic's Depth

The first-reveal "wow" is not sustained fun. Exhaust the mechanic: bring the genuinely good discoveries back to the player. Don't abandon your core idea mid-game.

**Idea density.** Count the distinct ideas surfaced per N levels. Jonathan Blow argues that revealing only 2–3 ideas across 15 puzzles is too low — the game is not mining its own depth. Idea density is a measurable proxy for whether a mechanic is being fully explored.

**Mechanic selection.** Choose a core mechanic that's easy to expand while you "find your game." Mechanics span a spectrum from self-contained (easy to start, limited ceiling) to labor-intensive (high barrier, underexplored territory). Jonathan Blow argues that labor-intensive territory is a competitive moat precisely because most developers avoid it.

**Orthogonality as process.** Strip mechanics to orthogonal (independent, composable) for clarity and a searchable possibility space, then add interaction back where depth is needed. Late hidden rule-surprises are easier to conceal in non-orthogonal mechanics — a design choice, not a flaw.

**Organic vs industrial construction.** Let puzzle elements take their natural form rather than forcing a tidy symmetric shape. Asymmetry can be required for what the puzzle does. A puzzle that looks "clean" but plays awkwardly has been shaped for the designer's eye, not the player's experience.

**Listen to the game.** Trust the cohesion signal: keep a quality bar that rejects "not good enough" additions. When the game wants a different connection than you planned, that signal is worth investigating. Prune content harder than systems. Jonathan Blow is skeptical of "procgen at scale plus a human quality pass" as a substitute for authored depth.

**Crafting and tech trees.** Systems that ask players to collect and combine need an intrinsic "why am I doing this?" or they collapse into inventory management. Jonathan Blow argues that crafting mechanics frequently make games worse by substituting busywork for meaningful choice.

**Every level should have a point.** Never say the same thing twice. A level that repeats a lesson already learned is wasted space.

---

## Contrivance Budget

Every rule is contrivance that adds "weight" to the machinery. A rule must return more than the weight it adds — and weight is measured in the *player's* cost (cognitive load, geometry to parse), not the designer's effort.

The minimum discipline is simply *noticing* how much you're adding: "Do I really need this?" Pace contrivance modularly: once players have internalized the base rules, those rules stop feeling like contrivance and the budget resets. Prefer fewer meaningful systems to many overlapping ones.

---

## Production Value and "Lift the Marginal Parts"

Presentation changes not just perception but *behavior*. Jonathan Blow describes a test where a beefier gun sound made players believe a weapon was buffed — they took more risks and scored more kills with identical stats. Better graphics, sound, feel, and level clarity "meet players where they are," shrinking the gap to an unusual design. He notes this principle can be applied honestly or used as a sellout's rationalization — the distinction matters.

**The marginal-parts heuristic.** Every design has parts that exceed expectations and parts that stay marginal. Concentrate effort on the marginal ones: redesign the unfun situations first, then raise feel and production value. The temptation is to polish the already-good parts because that work feels satisfying; the discipline is to fix what's weak.

**Legibility cues.** A concrete example: first-person 3D strips peripheral vision. A high-quality situational-awareness cue — such as a screen-edge vignette near genuinely deadly ledges, gated by real distance measurement and authored markup — addresses a specific legibility gap without cluttering the screen.

**Impressiveness from accumulation.** Impressiveness can come from the accumulation of many ordinary details, not one radical technique. A game that does many small things well reads as polished even without a single standout effect.

**Ludo-narrative reward coherence.** A reward cinematic that ignores what the player actually built or did fails to land. The reward must reflect the player's specific actions, not a generic success state.

---

## Input Feel and the Dev-vs-Player Blind Spot

Developers miss input-feel problems because they play differently than complainers. Jonathan Blow describes a specific case: he taps discrete keys, but players hold-and-time, so a committed move "eats" the turn in a way he never experienced during development. The blind spot is structural — the developer's muscle memory is different from the player's.

**Buffer moves.** Buffer moves so play happens "at the speed of your thinking." A player who inputs an action should not have to time it perfectly to avoid it being consumed by the wrong state.

**Undo and checkpoints.** For puzzle games, undo and checkpoints — including undo past a level restart — are core quality-of-life features, not optional conveniences. They lower the cost of experimentation and make the difficulty feel fair.

---

## Process and Objectivity

The defining professional skill is honestly admitting "this kind of sucks" and treating the prototype as a tool for navigating toward the good region — not a defense of your original vision. Jonathan Blow argues that the gap between professionals and amateurs is largely this: professionals can evaluate their own work without flinching.

**Silent playtesting.** Hand over a build and watch without intervening. Resist the urge to explain or guide. Treat the recording as a reality check against your assumptions. The moment you speak, you've contaminated the data.

**Start by doing.** If you have no specific design questions, you haven't begun. Specific questions come from doing. Jonathan Blow argues that "just start" is not a motivational platitude — it's a practical observation that the questions you need to answer don't exist until you have something to play.

**Anti-GDD stance.** Jonathan Blow argues that design lives in the playable build, not in prose — "draw the rest of the owl." A running to-do list is fine; heavy game design documents only justify themselves on 40+ person teams. This is a counterpoint to `references/design-artifacts.md`, which covers commitment artifacts and one-page designs.

---

## Evaluation Lenses

**Mistake counting.** "How many mistakes does it make?" is a useful judging lens. Quality-per-headcount is another: a small team that ships a tight, consistent game demonstrates more craft than a large team that ships a bloated one.

**Craftsmanship consistency.** Don't ship a half-baked surprise mode or extra content that collapses the experience. Jonathan Blow cites Inscryption as a game that undermines its own craftsmanship by adding a layer that doesn't meet the bar of the first act. Scope discipline is part of quality.

**Reward density vs world size.** A metroidvania can be better at half its map size. More world is not more game. Jonathan Blow argues that reward density — the ratio of interesting moments to traversal time — is a better metric than raw content volume.

**Novelty calibration.** Calibrate novelty honestly: iteration is not innovation. A game that adds features to an existing formula is not doing something new, and marketing it as such sets expectations it cannot meet.
