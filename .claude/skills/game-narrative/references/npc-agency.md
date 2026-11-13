# Writing NPCs with Agency

Deep-dive reference from Meg Jayanth's GDC talk "Forget Protagonists: Writing NPCs with Agency for 80 Days and Beyond." (Jayanth was a freelance writer on *80 Days*, contracted by inkle.) Covers NPC agency, protagonist constraint, entitlement simulation, and world-building through NPC perspective.

---

## Key Principles

### 1. Immersion Is Social

True immersion requires loss, failure, and frustration — not because suffering is good, but because real relationships demand things of us. A simulation of perfection fails because it's hollow. Players don't want the easy, transactional relationship with a perfectly compliant NPC; they want the thrill and unexpectedness of someone who has their own life.

The Truman Show is about a man realizing his relationships aren't real and trying to escape — not trying to go deeper in. Everything in the Truman Show is about Truman, and eventually that starts to feel shallow. Games keep trying to give players Laura Linney (perfect, compliant, always available) when what players actually want is someone real and messy.

**Design implication**: NPCs that exist only to serve the protagonist feel hollow. NPCs that have their own lives, goals, and limits feel real.

### 2. Entitlement Simulation

Most games are designed to give the player exactly what they want, uncritically. This produces:
- NPCs whose only purpose is to serve the protagonist
- Romances that are skill checks rather than relationships
- Worlds where every problem can be solved by the protagonist if they try hard enough
- Stories where the protagonist's actions ripple out into the world but the world never ripples back

**The test**: Who ever heard of a great novel where the protagonist got exactly what they wanted all the time? Entitlement simulation produces games that feel like power fantasies rather than stories.

### 3. Agency vs. Control

Player agency does not require player control. Agency is the ability to interact meaningfully with the game world — but "meaningfully" doesn't mean "causally." 

Consider a real friendship: a friend going through a breakup tells you about it. You listen, offer an opinion, maybe they follow your advice, maybe they don't. Your relationship isn't based on them following your directives. The meaning comes from the conversation, the connection, the fact that you care. You may have made a significant change in their life simply by listening.

**Design implication**: Giving the player the space to have an opinion, an emotional response, or a reaction can be as powerful as giving them the ability to do something. NPCs can have agency without the player losing agency — they just lose *control*.

### 4. Protagonist Constraint as Design Tool

Deliberately limiting what the protagonist can do creates space for NPCs to act. When the protagonist can solve every problem, NPCs become passive. When the protagonist's power is bounded, NPCs must act for themselves.

In *80 Days*, Passepartout's whiteness, maleness, and Frenchness are never treated as neutral or automatically powerful — they make him an outsider more often than they grant him access. NPCs deny him authority, question his motives, and pursue their own goals without his involvement. He can participate in revolutions, but he can't lead them — because the revolution was already happening without him.

**The ethical dimension**: How we assign agency is not a neutral design decision. If the protagonist can mechanically solve all NPC problems, we can't write stories of NPC power and ingenuity. Giving NPCs agency can be an ethical imperative, not just a design choice.

---

## Techniques and Patterns

### NPCs With Independent Goals

Every NPC should have at least one goal that doesn't involve helping the player. This goal should:
- Exist before the player arrives and continue after the player leaves
- Sometimes conflict with the player's goals
- Be pursued even when it costs the NPC something

**Dragon Age 2 example**: Isabela has pressures acting on her that the player doesn't fully know about. Regardless of the state of the player's relationship with her, she betrays and abandons the player because her own pressures override her loyalty. The player can't control what she does — only how they react.

**Anders example**: Whether in a romance with the player or not, Anders chooses his political ideals over his personal loyalties and commits an act of terrorism. There is no way to stop him or convince him out of it. His actions reflect on the player because the player chose to romance him — usually the protagonist's actions ripple out; here, an NPC's actions ripple back.

### NPCs That Lie

NPCs that lie feel real in a way that honest NPCs don't. Lying requires the NPC to have a private truth that differs from their public presentation — which means the NPC has an inner life. When the player discovers the lie, it recontextualizes everything that came before.

**Design consideration**: Lying NPCs require the game to track what the NPC knows, what they want the player to know, and what they're hiding. This is more complex to write but produces dramatically richer interactions.

### World-Building Through NPC Perspective

Instead of delivering world-building through journal entries or authoritative lore documents, deliver it through NPC opinions — which are necessarily partial, biased, and personal.

In *80 Days*, almost every NPC has a slightly different opinion of the Artificers' Guild. The player experiences the world through these contradictory perspectives and constructs their own understanding. There is no definitive truth in a lore document — the truth is assembled from competing perspectives.

**Why this works**: Contradictory NPC opinions make the world feel complex and alive. A world where everyone agrees about everything feels like a stage set. A world where people disagree, have personal stakes, and hold biased views feels like a real place.

**Practical benefit**: World-building through NPC perspective is modular — each NPC's opinion can be written independently, and adding more NPCs adds more texture without requiring a central lore document to be updated.

### No NPC Bears the Weight of Representing a Category

When there are few NPCs from a particular culture, gender, or background, each one bears the weight of representing the entire category — producing stereotypes and mouthpieces. The solution is more NPCs, not better-written individual NPCs.

In *80 Days*, no single NPC has to represent an entire culture because there are so many NPCs. Each can be specific, contradictory, and individual.

**Practical implication**: If you can only write one NPC from a particular background, that NPC will feel like a representative rather than a person. Design systems that allow for multiple perspectives.

### Content That Belongs to the NPC

Some NPC stories are not for the player. Some things should be left over for the NPC — not in service of the player, the protagonist, or the plot.

In *80 Days*, there are situations where Passepartout encounters a person and cannot do anything to influence them. The story belongs to the NPC. The player's role is to witness, not to solve.

**The Murray girl example**: An Aboriginal woman in Brisbane refuses Passepartout's offer to help because she doesn't trust him — his whiteness and outsider status make him closer to the oppressor than to her. No amount of protagonist effort can overcome this. The story is hers, not his. Players debated how to "unlock" her trust; the answer is that it's not a puzzle to be solved.

### Limiting Protagonist Power Without Limiting Player Agency

The protagonist's power can be bounded without removing the player's agency:
- **Social/cultural limits**: the protagonist is an outsider, lacks authority, or is in the wrong social position
- **Structural limits**: the problem is political or systemic, beyond any individual's ability to solve
- **Relational limits**: the NPC has reasons not to trust the protagonist that can't be overcome in a single conversation

The player retains agency through how they react, what they understand, and what relationships they build — not through whether they can solve every problem.

---

## Anti-Patterns

### The Fridge

Killing or harming NPCs to motivate the protagonist. This treats NPCs as props for the protagonist's emotional journey rather than as people with their own stories. The NPC exists only to be lost.

### The Skill Check Romance

Romances where the NPC's affection is a resource to be accumulated through correct dialogue choices. This treats the NPC as a puzzle to be solved rather than a person to be known. The "win state" (sleeping together, declaring love) ends the relationship rather than beginning it.

### The Savior Structure

The protagonist arrives, solves the NPC's problem, and leaves. The NPC exists to be saved. This is the quintessential entitlement simulation structure — and it's particularly harmful when the NPC's problem is political or systemic, because it implies that individual protagonist action can solve structural injustice.

### The Mouthpiece

An NPC whose only function is to deliver exposition or represent a cultural/political position. Mouthpieces have no inner life — they exist to inform the player, not to be people. The test: does this NPC have any goals or opinions that aren't directly relevant to the player's current quest?

### Treating "Unfair" as the Worst Thing a Game Can Be

Games train players to expect that all problems can be solved by the protagonist if they try hard enough. When an NPC refuses to be helped, players often experience this as unfair. But unfair isn't the worst thing a game can be — and sometimes the refusal is the entire point. Design for the possibility that the player cannot fix everything.

---

## World Agency Patterns

NPC agency can operate at the systems level — not just individual characters with goals, but entire worlds that move without the player.

### Time-Based Scheduling

*Majora's Mask*: NPCs follow fixed schedules that advance regardless of player action. The world doesn't wait. This creates urgency and the feeling of independent existence — the player must observe and intercept rather than initiate.

### Faction Warfare Simulation

*Mount & Blade*, *Crusader Kings*: AI factions pursue goals, conquer territory, and form alliances. The player is one actor among many rather than the sole mover of history.

### Emergent Procedural Quests

*Drox Operative 2*: Quests generate from world-state changes rather than being hand-placed. A faction conquers a settlement; a quest to reclaim it spawns organically. The world produces its own narrative.

### Why Oblivion's Radiant AI Failed

NPC agency without supporting game systems produces chaos that's visible but not meaningful. NPCs killing each other for bread is emergent but not interesting — the player has no way to predict, prevent, or exploit it. Agency requires player-legible consequences.

**Design implication**: NPC agency is a core-design commitment, not a bolt-on feature. It requires the entire game to be built around a world that moves without the player.
