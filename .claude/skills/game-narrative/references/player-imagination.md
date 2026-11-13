# Player Imagination as Narrative Tool

Deep-dive reference from Sam Barlow's PRACTICE 2016 talk "Game Designing Like a Writer: How Her Story Was Constructed Entirely on Paper." Covers search-based narrative, sculptural story structure, writing from character out, and balancing non-linear discovery.

---

## Key Principles

### 1. The Player as Co-Author

The most powerful thing interactive narrative can do is put the player in the same position as the creator — not by stopping the story and asking "what happens next?" but by letting the player feel like they're sitting beside the author as the story is being told.

In linear narrative, the reader/viewer receives meaning. In search-based narrative, the player constructs meaning from fragments. The act of construction is the experience. A player who assembles a story from disparate clips is more engaged than one who watches it unfold — they own the interpretation.

**Design implication**: Don't explain everything. Leave gaps. The player's imagination filling those gaps is more powerful than any authored content you could put there.

### 2. Sculptural Narrative

Think of the story as a three-dimensional object that already exists. The player is a sculptor revealing it — chipping away from any angle, revealing the form gradually. This is different from:
- **Linear narrative**: a path with a start and end
- **Branching narrative**: a tree with decision points
- **Sculptural narrative**: a complete object that can be approached from any direction

The key property: any fragment of the story should contain enough context to orient the player. The story cannot be "broken" by early discovery of a key fact — instead, early discovery shifts the player's mode of engagement (from "whodunit" to "howdunit" to "whydunit").

**The detective genre evolution**: Agatha Christie's whodunit → Columbo's howdunit (you know who did it, the drama is watching Columbo close in) → Scandinavian crime's whydunit (the psychology of the perpetrator). A sculptural narrative can support all three modes simultaneously, depending on what the player discovers first.

### 3. The Iceberg Principle Applied to Games

Hemingway's iceberg: only the tip is visible; the whole story happens off the page. In *Her Story*, the story happens in the arrangement of clips — in the montage, in what's implied between results, in what the player infers from fragments. The most powerful storytelling is what isn't shown.

When a player searches a word and gets six results, the mini-narrative created by those six clips is often richer than any single clip. The juxtaposition is the story. The player's act of connecting them is the act of reading.

### 4. Robustness Through Character Depth

A story built on authentic character psychology is robust to non-linear discovery. If a character's voice, motivations, and subtext are consistent throughout, the player can enter at any point and orient themselves quickly — just as you can turn on a movie halfway through and understand what's happening within minutes.

The fragility of linear narrative is that it depends on sequence. The robustness of sculptural narrative comes from character consistency: every fragment contains the character, and the character contains the story.

---

## Techniques and Patterns

### Writing From the Character Out

Write every scene from the character's authentic headspace, not from the designer's structural needs. The character's agenda drives the scene; structural requirements are satisfied after the fact.

**Process**:
1. Know each character's agenda for this scene (what do they want? what are they hiding? what are they afraid of?)
2. Write the scene as if you are that character — let the dialogue go where the character would take it
3. After writing, check whether the scene serves structural needs; if not, revise the scene to add structural hooks *without breaking the character's voice*

**Why this matters for non-linear narrative**: Scenes written from character headspace feel authentic in isolation. Scenes written from structural need feel mechanical when encountered out of sequence — the scaffolding shows.

### The Balancing Process

After writing all scenes from character, analyze the content mathematically to identify structural problems:

1. **Score each clip** by how interconnected it is with others (how many searchable words does it share with other clips?)
2. **Identify low-scoring clips** — content that players are unlikely to discover
3. **Revise low-scoring clips** to add thematic resonance and discoverable keywords — not to fix structure, but to make each clip earn its place thematically

The key insight: revisions should add thematic depth, not just discoverability. A clip that becomes discoverable because it now contains a thematically resonant word is better than a clip that becomes discoverable because you added a random keyword.

**Example from Her Story**: A clip where the protagonist looks at a photo of the detective's children and says "cute, what ages are they?" was low-scoring (no one would search "cute"). Revision added "you must really love them" — now the clip is discoverable via "love," and the word "love" adds thematic resonance to a story about different kinds of love.

### Curating Search Results

In a search-based system, the set of results returned for a query is itself a narrative unit. Design the result sets, not just the individual clips:

- **Six or seven results** feels like there's something just out of reach — tantalizing
- **Evocative words** (wedding, husband, wife, love) create rich result sets that tell mini-stories through juxtaposition
- **Revise clips** to include or exclude specific words, controlling which clips appear together in a result set

This is film editing applied to database design: the arrangement of clips is the montage; the montage is the story.

### Keeping the Story Alive During Production

The enemy of narrative game production is getting lost in the mechanics and losing the story. Strategies:
- **Write the story first**, before touching a game engine
- **Use a simple prototype** (even a spreadsheet) to validate the core experience before building anything
- **Write scenes in isolation** — don't worry about how they fit the larger structure while writing; use data analysis to identify structural problems after the fact
- **Separate the writing process from the balancing process** — writing is about character; balancing is about discoverability

---

## Anti-Patterns

### Flowcharting the Story Before Writing It

Trying to map out a non-linear story as a flowchart before writing it produces mechanical, lifeless content. The flowchart imposes structure on character before character has had a chance to breathe. Write the story first; impose structure second.

### Treating Early Discovery as Failure

If a player discovers a key fact early, that's not a failure state — it's a shift in engagement mode. Design for this: a player who knows "whodunit" early should find the "howdunit" and "whydunit" equally compelling. The story should reward deeper engagement, not punish early discovery.

### Over-Explaining

Every piece of information you provide explicitly is a piece of imagination you've taken from the player. Leave gaps. Let the player infer. The sensation of "I figured it out" is more powerful than "I was told."

### Writing for Structure, Not Character

Scenes written to hit structural beats rather than from character headspace feel mechanical in isolation. In a non-linear system, every scene is encountered in isolation — it must work on its own terms. Write from character; structure will follow.

### Assuming the Story Can Be Broken

A story with authentic character psychology and consistent thematic imagery is robust to non-linear discovery. Don't over-engineer discoverability at the expense of authenticity. Trust the story.

---

## The Branching Limit

k choices at n decision points produces k^n possible outcomes. True branching narratives are mathematically impossible at scale — 3 choices over 10 decision points generates 59,049 unique paths. No studio can write that.

Three practical solutions:

1. **Linear with illusion** — paths reconverge; choice affects tone and details, not structure (Telltale).
2. **Smaller scope, real branching** — fewer decisions, each genuinely diverges (Heavy Rain, Detroit: Become Human).
3. **Emergent consequences** — choice matters through relationship and reputation systems rather than plot divergence (Disco Elysium, Crusader Kings).

**Design implication**: meaningful choice ≠ branching plot. A linear plot where choices change *how* you experience it — who trusts you, what resources you have, which NPCs survived — can feel more meaningful than a branching structure where the branches are thin.
