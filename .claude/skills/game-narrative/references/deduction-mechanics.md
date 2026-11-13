# Deduction Mechanics for Detective Games

Deep-dive reference from Jon Ingold's (inkle) "The Burden of Proof: Narrative Deduction Mechanics for Detective Games." Covers the deduction loop, combination lock problems, the constructed argument model, and the two-story structure of mystery.

---

## Key Principles

### 1. The Detective Game Loop

A detective game is defined by its mechanic, not its setting. The core loop:

1. **Discover** — find a piece of information (clue, observation, testimony)
2. **Deduce** — think about what it means
3. **Prove** — demonstrate to the game that you understood it

The "prove it" step is the interesting design space. The game can't read the player's mind — the player must take some action that expresses their understanding. This action is a **combination lock**: it requires comprehension, not just input. A button labeled "I understand" is not a combination lock; going to the right location at the right time because you understood a clue is.

**The failure modes**:
- Player understands but can't express it (deduction space too narrow)
- Player can express the correct action without understanding (deduction space too wide, or the game is linear)

### 2. What Makes a Detective Game

The distinction is between games *about* detectives and games that require *detective work*. The interesting bit is the expression step — the player telling the game "I get it, give me more." Games that guide the player through detective-flavored content without requiring genuine deduction are not detective games by this definition.

**Examples by this definition**:
- *Her Story*: search mechanic requires genuine inference; the player constructs understanding from fragments
- *Outer Wilds*: location and timing combination locks require genuine understanding of the world's physics and history
- *Overboard*: the accusation scene requires the player to construct a convincing argument from the evidence they've gathered

**Counter-examples**:
- *The Witcher 3*: detective-flavored story, but the player is guided through linear sequences without being asked to prove understanding
- *L.A. Noire*: interrogation mechanic hopes to be deduction, but branches more on player skill than genuine comprehension

### 3. The Problem With Fact-Linking

The most natural deduction mechanic — "fact A + fact B = new fact C" — has fundamental problems:

**Facts must be representable in UI**: Real detective deduction often involves intuition, knowledge of human nature, and unspoken social rules. These can't be put in a fact box. Reducing deduction to explicit facts flattens the richness of mystery.

**The conclusion might not be exciting**: Players who are ahead of the narrative know the answer but must go through a mechanical process to express something obvious. Deeply frustrating.

**Overwhelm**: Fact lists grow as the game progresses. Cross-referencing a large fact list is cognitively exhausting — like finding matching fish in a page of identical-looking fish. Even when the answer is fair and logical, the search is unpleasant.

**Hard to write**: Where does one fact end and another begin? Is "Elsa is lying" a different fact from "Elsa is lying to protect Ana"? Atomic fact decomposition is a design problem with no clean solution.

### 4. The Constructed Argument Model

Instead of hunting for the single correct answer in a possibility space, the player *builds* a truth:

- Evidence is assembled piece by piece
- Each piece is examined and tested before the next is applied
- The player constructs an argument, not a combination lock solution
- Multiple valid arguments can reach the same conclusion (truth is broad)

**The maze metaphor**: In a combination lock, there is one correct input. In a maze, there are dead ends you can walk back from, multiple paths to the exit, and no single "correct" route. The player is constructing a path, not cracking a code.

**The Watson model**: The player is Watson feeding ideas to Holmes, not Holmes who already knows. The detective doesn't get to be the judge — someone else assesses the quality of the argument. This creates space for the player to be wrong, to refine, to improve a semi-coherent idea into a fully coherent one.

---

## Techniques and Patterns

### The Two-Story Structure

Every mystery has two stories:
1. **The crime story**: what happened and why — the secret history being uncovered
2. **The investigation story**: the detective and characters dealing with the aftermath — the adventure the player is living

Christie layers these together and brings them together in the climactic accusation scene. Conan Doyle separates them (80% adventure, 10% explanation). Both are valid structures, but both stories must be compelling.

**Design implication**: Don't over-invest in the crime story at the expense of the investigation story. Players root for the detective, not the backstory. The investigation story — the characters, the relationships, the dramatic situation — is often more engaging than the mystery itself.

### The Accusation Scene (Overboard Model)

*Overboard*'s climactic accusation scene implements the constructed argument model through conversation:

1. **Topics are introduced in priority order** — each piece of evidence or storyline is a topic
2. **Each topic is discussed by the group** — the player can argue, lie, redirect
3. **Each topic reaches a conclusion** — accepted by the group as definitively true or false
4. **Conclusions accumulate** — a ledger of outcomes, not a combination lock
5. **A judge NPC weighs the ledger** — and delivers a verdict based on the accumulated evidence

**Key properties**:
- The player cannot "win" by knowing the right answer — they must construct a convincing argument
- Topics can recontextualize previous conclusions (later evidence can flip earlier verdicts)
- The system degrades gracefully — ambiguous outcomes produce ambiguous verdicts, not broken states
- The player's high-agency actions during the main game loop determine the parameters of the accusation scene

### High Agency / Low Impact → Low Agency / High Impact

Structure the game in two phases:
1. **High agency, low impact**: the player makes many choices (where to go, what to do, what evidence to gather or destroy) but individual actions have limited immediate consequences
2. **Low agency, high impact**: the accusation/solve scene — the player's options are now constrained, but every choice matters because the initial conditions have been set

This structure creates dramatic tension: the player spends the game setting up their position, then watches it play out with limited ability to course-correct. The accusation scene must be designed to handle the full range of states the player can arrive in — see "The Linear Accusation Scene" anti-pattern below.

### Curated Input Systems

Avoid overwhelming the player with too many options at the deduction step. The goal is "just a few fish, not quite so many fish." Techniques:
- **Topic-by-topic discussion**: address one piece of evidence at a time rather than presenting all evidence simultaneously
- **Conversation as UI**: dialogue is a natural, familiar interface that doesn't require a separate UI system to learn
- **Priority ordering**: deal with the most important topics first; less important topics can be skipped if the verdict is already clear

### The Fallback Position

Always design a fallback for ambiguous outcomes. In *Overboard*, if neither suspect has a clear majority of guilty outcomes, the verdict is "suicide" — a narratively justified ambiguous ending that signals to the player "go away and try harder." The fallback should:
- Be narratively coherent (not a system error)
- Signal that the player should try again with different parameters
- Not feel like a punishment for playing well

---

## Anti-Patterns

### The Combination Lock as Default

Designing every deduction step as a single correct answer creates frustration when players understand the situation but can't find the specific input the game expects. Reserve combination locks for simple, obvious deductions; use constructed arguments for complex ones.

### Sherlock Holmes as Player Fantasy

Casting the player as the infallible master detective who already knows the answer removes the fun of deduction. Holmes is not having fun — he just knows. The interesting experience is the process of figuring it out. Cast the player as Watson: someone who has ideas, feeds them to a system, and sees whether they hold up.

### Narrative Sudoku

Assembling a complete picture of the truth through incremental clue discovery is satisfying as a process, but it doesn't produce a climactic revelation. Sudoku doesn't generate "of course — it was a five all along, that changes everything." Detective stories need a solve that surprises and then feels inevitable. Design for revelation, not completion.

### Fact Atomization

Trying to decompose all knowledge into atomic facts for a linking system produces a design problem with no clean solution. Facts are not atomic — "Elsa is lying" and "Elsa is lying to protect Ana" are both facts, and both have different implications. Use conversation and argument instead of explicit fact lists.

### The Linear Accusation Scene

A climactic solve scene with a single correct path through the conversation fails when the player has taken an unexpected route through the game. The accusation scene must be flexible enough to handle the full range of states the player can arrive in — including states where key evidence has been destroyed, key witnesses are unavailable, or the player has constructed an entirely different picture of events.
