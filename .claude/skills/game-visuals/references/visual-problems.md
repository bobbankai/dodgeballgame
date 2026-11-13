# Common Visual Problems and How to Solve Them

A diagnostic framework for identifying and fixing visual design failures in games. Load this when critiquing visuals, diagnosing a specific problem (contrast, hierarchy, saturation, accessibility), or needing vocabulary to communicate with artists.

---

## Table of Contents

1. [The Critique Framework](#the-critique-framework)
2. [Core Vocabulary](#core-vocabulary)
3. [Diagnosing Common Problems](#diagnosing-common-problems)
4. [Diegetic vs Non-Diegetic Signaling](#diegetic-vs-non-diegetic-signaling)
5. [Accessibility Beyond Color](#accessibility-beyond-color)
6. [Practical Critique Process for Games](#practical-critique-process-for-games)
7. [Anti-Patterns](#anti-patterns)

---

## The Critique Framework

Effective visual critique requires knowing what you're looking for before you judge. The instinctive approach — "it's too blue, make it green" — often fixes the wrong thing. A structured approach:

1. **Describe**: What is literally in the image? Content, not judgment.
2. **Analyze**: How was it made? What visual elements are at work (color, contrast, density, line)?
3. **Interpret**: What was the artist trying to achieve? What are the game's visual goals?
4. **Judge**: Given the goals, is it effective?

**The key difference for games**: You define your own goals. Common game visual goals include:
- **Information**: Players can read state at a glance (danger, interactivity, resource levels)
- **Focus control**: Players look where you need them to look
- **Emotion**: The visual tone supports the genre's emotional register
- **Style**: The aesthetic is coherent, memorable, and appropriate to the game

---

## Core Vocabulary

### Value
The light-to-dark gradient, independent of hue or saturation. Value contrast is the most powerful tool for making things legible. When you convert an image to grayscale, value contrast is all that remains — if your character doesn't stand out in grayscale, they won't stand out in color either.

### Hue
Color as we learn it as children — the rainbow. Red, orange, yellow, green, blue, purple. Hue contrast differentiates elements that have similar value and saturation.

### Saturation
How gray or vibrant a color is, independent of hue and value. Maxed saturation produces garish, painful visuals. Varied saturation — some vivid, some muted — creates visual interest and hierarchy.

### Contrast
Contrast can be between any of the three color dimensions:
- **Value contrast**: light vs. dark (most legible, works for colorblind users)
- **Hue contrast**: different colors (Chinese checkers: differentiated only by hue)
- **Saturation contrast**: vivid vs. muted (checkers: vibrant red vs. desaturated black)

### Density
How much visual information is on screen. High density = busy, chaotic, alive. Low density = open, minimal, easy to follow. Density can be in the amount of content or in the detail level of content. The key: **background density should be lower than foreground density** so the player's eye naturally finds the important elements.

### Visual Hierarchy
The ordering of visual importance. The most important element (player character, key information) should have the highest contrast relative to its surroundings. Secondary elements have medium contrast. Background elements have low contrast. Violating hierarchy — making the background more visually interesting than the player — is one of the most common problems in indie games.

---

## Diagnosing Common Problems

### Problem: Character Invisible Against Background

**Diagnosis**: Value contrast failure. Convert to grayscale — if the character doesn't pop, the problem is value, not hue.

**Solutions**:
- Increase value contrast on the character (make it lighter or darker relative to background)
- Reduce value contrast in the background (push it toward midtones)
- Design the player character to be high-contrast so it works against a wide range of backgrounds — this gives you more freedom with background variety

**Principle**: A high-contrast player against a low-contrast background is more flexible than a light player against a dark background (which constrains all your background choices).

### Problem: Oversaturated, Painful Colors

**Diagnosis**: Literal color thinking — "trees are green, so max green." Saturation at maximum everywhere produces visual noise, not vibrancy.

**Solutions**:
- Reduce overall saturation and vary it — not everything needs to be vivid
- Make non-literal color choices: a tree trunk can be purple; it's more interesting and less painful
- Separate high-saturation elements spatially — don't put maximum-contrast hues (red and green) on the same character or adjacent elements

**Principle**: Nintendo's games look vivid because they have *varied* saturation levels, not because everything is maxed. Mario is red and blue; Luigi is green and blue — neither character puts red and green together.

### Problem: 3D Lighting Too Dark / Harsh Shadows

**Diagnosis**: Compensating for darkness by increasing point light intensity, which creates harsh black shadows and blows out highlights.

**Solutions**:
- Use an environmental/ambient light or skybox to establish a flat base light level — this lifts shadow floors and reduces overall contrast
- Then use colored lights for narrative effect (warm candlelight, cool moonlight) rather than neutral white intensity
- Intentional lighting is about mood, not just visibility

**Principle**: Lighting should be designed, not just "bright enough to see." The ambient light establishes the floor; directional lights create drama on top of it.

### Problem: Fancy Background Competes With Player

**Diagnosis**: Value contrast and density are higher in the background than in the player. The eye goes where contrast is highest.

**Solutions**:
- Reduce value contrast in the background (push toward midtones)
- Reduce density in the background (less detail, less busy)
- Increase contrast on the player character

**Principle**: Backgrounds should be interesting but subordinate. Design them to recede, not to compete.

### Problem: Colorblind Accessibility

**Diagnosis**: Relying on hue alone to differentiate game elements (red enemy vs. green ally). About 5–6% of players are colorblind.

**Solutions**:
- Value contrast works for everyone — if elements differ in value, they're distinguishable regardless of color vision
- Add shape/symbol differentiation alongside color (stars for good, X's for bad)
- Use size to communicate type (small bullets = friendly, large = enemy)
- Color lookup table (LUT) transforms can remap the entire game's colors for colorblind modes — useful as a supplemental option, but not a substitute for redundant encoding

**Principle**: Every accessibility improvement for colorblind users also improves legibility for everyone. Value contrast is universal. For redundant encoding strategies that go beyond value contrast, see [Accessibility Beyond Color](#accessibility-beyond-color).

### Problem: "Too Cute" / Wrong Emotional Register

**Diagnosis**: Visual elements signal the wrong emotional tone. Usually a combination of high saturation, large heads/eyes (cute proportions), and soft shapes.

**Solutions**:
- Reduce saturation to shift toward the intended mood
- Adjust proportions: large heads/eyes = cute; realistic proportions = weight and consequence
- Be intentional about every stylization choice — they accumulate

**Principle**: Style elements (color, line, proportion, light/shadow) are not independent. They combine into an overall emotional register. Changing one changes the whole.

### Problem: Incoherent Visual Style

**Diagnosis**: Style elements don't go together — very stylized color with accidentally realistic proportions, or cartoon line on a realistic model.

**Solutions**:
- Audit each style element independently: color, line, proportion, light/shadow
- Make intentional choices about each one
- Ensure they're cohesive — a stylized game can have any combination of these elements, but they need to be chosen deliberately

**Principle**: Cohesion comes from intentionality. You can combine stylized color with realistic shadow, but you have to choose that combination on purpose.

---

## Diegetic vs Non-Diegetic Signaling

Not all color-coding is equal. The distinction is whether a signal *enables* player decisions (option) or *replaces* them (instruction).

**Red explosive barrels work** because real-world hazard labeling provides in-world justification — the color is diegetic. More importantly, they signal an *option*, not a requirement. Players choose whether to engage; the signal expands their decision space.

**Yellow climbable surfaces fail** when there's no in-world reason for the paint — the signal is non-diegetic. Worse, it typically marks the *only* path forward, making it mandatory. Players have no real choice; the signal replaces navigation with instruction.

**Good pattern**: Mirror's Edge Runner's Vision — thematically grounded, toggleable, and it shows *one possible path* among many. Players can ignore it and route differently.

**Principle**: Does your visual signal say "you CAN go here" (option) or "you MUST go here" (command)? Signals that communicate options build player agency; signals that communicate commands erode it.

---

## Accessibility Beyond Color

Color alone must never be the sole carrier of critical gameplay information. The solution is redundant encoding, not color filters.

**Why color filters fail**: Full-screen deuteranopia/protanopia filters shift the problem rather than solving it — they make some things visible while making others invisible. Players don't want their whole screen tinted; they want to read the game's information channels clearly.

**The redundant encoding principle**: Every piece of information conveyed by color must also be conveyed by at least one additional channel:
- **Shape**: Team indicators use icon shape AND color (triangle vs. circle, not just red vs. blue)
- **Pattern**: Loot rarity uses background pattern/texture AND color border
- **Size/position**: Health uses fill amount AND color gradient
- **Label/text**: Status effects show icon AND text name, not just a colored dot
- **Animation**: Interactable objects pulse or shimmer in addition to being highlighted

**Testing**: Desaturate your game to grayscale. If you can't distinguish all critical information, you have a redundant encoding gap.

**Good examples**: World of Warcraft (color intensity sliders per channel), Fortnite (distinct shapes for each rarity tier), Splatoon (pattern-coded ink), Celeste (customizable UI colors).

**Bad patterns**: Full-screen color filters as the only accessibility option. "Just make the reds more blue." Assuming the default palette works for everyone.

**Principle**: Accessibility isn't a filter bolted onto finished work — it's a constraint that produces clearer visual design for all players. Redundantly-encoded UI is more readable for everyone, not just colorblind players.

---

## Practical Critique Process for Games

1. **Remove gameplay elements** and evaluate the background in isolation first
2. **Convert to grayscale** to check value hierarchy
3. **Identify the visual goal** for each element: what information does it need to communicate?
4. **Check density balance**: is the background less dense/contrasted than the foreground?
5. **Check colorblind legibility**: does value contrast alone differentiate important elements?
6. **Check emotional register**: do style choices (saturation, proportion, line) match the genre's tone?

---

## Anti-Patterns

**Instinctive critique without vocabulary**: "It's too blue" doesn't tell an artist what to fix. "The background has higher value contrast than the player character" does.

**Fixing the symptom, not the cause**: Making something "less blue" when the real problem is value hierarchy.

**Treating saturation as vibrancy**: Maximum saturation everywhere produces pain, not energy. Varied saturation produces visual interest.

**Ignoring colorblind accessibility**: 5–6% of your players are colorblind. Value contrast is free and universal.

**Inconsistent style elements**: Accidentally combining cute proportions with horror tone, or realistic shadow with cartoon color, without intending the combination.
