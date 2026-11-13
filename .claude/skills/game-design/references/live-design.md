# Live Design

Designing games for ongoing play — content cadence, player retention, economy management, and ethical monetization. Load this when designing a game-as-a-service, planning content release schedules, or diagnosing why player numbers are declining.

---

## The Core Problem

**Source:** Chris Wilson, "Designing Path of Exile to Be Played Forever" (GDC 2019).

PvE games have a fundamental retention problem: players can exhaust the content. Unlike PvP games (endlessly replayable because opponents vary), a single-player story has a clear end. Once players finish, they leave.

The solution is not more content — it's **designing the game so players want to return**, not just continue.

---

## The Five Design Pillars for Longevity

These are the properties that make a game worth thousands of hours, not dozens:

1. **Visceral action** — moment-to-moment play must feel good. This is table stakes.
2. **Randomly generated levels** — players can't memorize a layout they've never seen. Replayability requires genuine variation.
3. **Randomly generated items** — items are progress. Random items create non-linear progression (no "3 items left to finish") and make small upgrades feel meaningful.
4. **Secure online economy** — items must have real value. If items can't be traded or are easily duped, they feel worthless. Trade gives items weight.
5. **Deep character customization** — thousands of valid builds mean each playthrough can be genuinely different.

**The key insight on items:** Don't create a linear item progression where players can see the endpoint. Random items with overlapping stats create diminishing returns — the best items from launch may not have been found yet. This keeps the hunt alive indefinitely.

---

## Content Cadence: The 13-Week League

The most important structural decision in Path of Exile's history was establishing a **predictable, regular release cadence**.

**What doesn't work:**
- Weekly small patches — never moved player numbers; players don't return for incremental changes
- Irregular releases — players can't plan around them; the game looks like it's dying
- Pipelining multiple releases — splits team attention, prevents reacting to what the game actually needs

**What works:**
- 13-week leagues (4 per year), each with a full content package
- Announced 3 weeks before launch so players can plan
- Economy reset with each league (fresh start = equal footing = re-engagement)
- Balance changes between leagues, not during them

**The streamer principle (from Kripparian):** Predictable schedules let players and content creators plan around you. The day you're not there is the day they find something else. Reliability compounds over time.

---

## Economy Resets as Re-Engagement Mechanics

The economy reset is the most powerful retention tool in live service design:

- Fresh economy = equal footing for all players
- Players who disengaged can return without being permanently behind
- The race to establish early economy positions creates urgency and excitement
- Veterans and new players compete on the same terms at launch

**How to reset without alienating existing players:** Don't delete old characters — move them to a "standard" league. The new league is where the exciting content is; the old league is where your history lives. Players choose to engage with the new economy, not have their progress erased.

---

## Content Scope and Marketing Threshold

Small content updates don't move player numbers. There's a **marketing threshold** — a minimum content size below which players don't tell their friends, journalists don't cover it, and the game doesn't trend.

**Below threshold:** Adding a new skill gem. Players who are already playing notice; no one returns.

**Above threshold:** A new act, a new character class, a major league mechanic. Players message each other; streamers cover it; the game trends.

**The batching principle:** Accumulate content until you cross the threshold, then release it all at once. You get both the quality improvement (game is better) and the marketing effect (people talk about it).

---

## Targeting Multiple Player Psychographics

Each release should contain something for every type of player. Path of Exile's marketing page structure maps to distinct player motivations:

- **Story players** — new setting, characters, narrative context
- **Combat players** — new gameplay mechanic that changes how combat feels
- **Meta-progression players** — new long-term system to build up over the league
- **Aspirational players** — endgame content only the top 10% can reach (but everyone watches)
- **Crafters** — new item mods and crafting systems
- **Build optimizers** — balance changes that make previously-weak builds viable
- **Completionists** — new items in regular monster drops

**The 10% content rule:** Endgame content that only 10% of players reach is worth 20% of development effort, because those players are disproportionately streamers and community leaders. Their engagement creates aspirational motivation for the other 90%.

---

## Ethical Monetization

Path of Exile's model: cosmetic microtransactions only. No pay-to-win.

**Why this works:**
- Competitive games require a fair playing field. Selling power destroys the economy of achievement.
- Players who feel the game is fair are more likely to spend on cosmetics — they're investing in something they value.
- The supporter pack model (tiered bundles at launch) front-loads monetization to the moment of highest engagement.

**The monetization timing insight:** Monetize heavily at league launch, when player engagement peaks. Players who stop playing mid-league will return for the next one — and buy again at launch. Don't chase players who are burning out; let them rest and return fresh.

---

## Quality Curve and Prioritization

With 13-week cycles, you cannot polish everything. The quality curve has an asymptote — 50% of the effort gets you 90% of the quality.

**The critical skill:** Knowing what actually matters. Polish the things players will notice and interact with most. Don't spend time on edge cases that affect 1% of players.

**The "game needs to be its best now" principle:** Don't stall content for future releases. If something is ready, ship it. The game needs to be in its best form at all times — you don't get second chances with players who churn.

---

## Community Engagement as Retention

Players who stop playing but remain engaged with the community (reading patch notes, watching streams, discussing builds) are not lost — they're on a planned return. 

Path of Exile's community engagement never drops below 50% of peak even when active players drop to 20%. These community members:
- Buy cosmetics for the next league
- Predict server capacity (community activity is a leading indicator of launch numbers)
- Maintain the game's presence and word-of-mouth

**Design for the pause, not just the play.** Players should quit knowing when they're coming back. Make the next league date visible and compelling before players burn out.

---

## Diagnostic Questions

- Do players know when the next major content release is?
- Is your content release above the marketing threshold?
- Does your economy reset create re-engagement opportunities?
- Are you targeting multiple player psychographics in each release?
- Is your monetization model compatible with a fair playing field?
- Are you polishing the right things, or spreading effort evenly?

For how content cadence relates to player motivation, see `player-experience.md` if not already loaded. For economy design principles, see `balance-and-competition.md` if not already loaded.
