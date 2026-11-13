# Combat, AI, Bosses, Temporal Systems, Controller (standard)

Source: directive §16-§19, §22 and master directive combat/AI/time/physics sections.

## Combat
Light + heavy attacks · multi-hit combos + variations · block · **perfect parry** · counters · directional dodges · lock-on + target switching · stagger · guard breaks · recovery · aerial/launcher follow-ups ·
environmental interactions · contextual finishers · cinematic boss finishers · temporal abilities.
Requirements: accurate hit detection (hitboxes from the striker bone during the clip's hit window), proper timing, **input buffering**, animation cancel windows, clear enemy reactions, reliable defence,
responsive movement, satisfying impact feedback (controlled hit-stop, sound, camera feedback, effects). Consistent hitboxes, damage, stamina/guard resources, recovery windows, interruptions, target priority.
Anticipation, movement, impact, recovery on every attack. Never fake combat by subtracting health. Rewards timing, strategy, positioning, ability mastery.

## Enemy AI
Behaviour trees / HFSM / utility. Patrol, detect, investigate, pursue, navigate, spacing, attack selection by distance/state, defend, stagger recovery, react to temporal abilities, return to patrol.
Archetypes with distinct combat styles, attack patterns, movement, defence, animation sets, strengths/weaknesses, audio cues: standard HELIX security, fast temporal operatives, defensive armoured,
elite close-combat, temporal anomalies, experimental machines, boss-only. Elites behave differently from standard enemies.
Groups: spacing, intelligent repositioning, coordinated openings, **attack tokens** (no excessive simultaneous attacks, no stacking), readable and fair. All behaviour synchronised to animation.

## Bosses (each a designed encounter, never a few attacks until health hits zero)
Unique model · distinct animations · specialised AI · multiple *meaningful* phases (phases change gameplay, not just numbers) · unique mechanics · clear telegraphs · defensive openings · environmental interaction ·
cinematic introduction · phase transitions · defeat sequence. Sentinel A-07 (2 phases) · Rift Marshal · The Echo · Commander Nyx (3 phases) · Director Voss (3 phases; the most sophisticated, tests every ability).

## Temporal systems (fixed-timestep, clear state ownership, no fragile hacks)
- **Time Slow:** slows enemy behaviour, animation playback, supported physics and environment; synchronised visuals + audio; balanced energy cost.
- **Time Rewind:** bounded recorded history; restores player, relevant enemies, designated physics objects; syncs animation + collision; permanent story progress / checkpoints are protected.
- **Temporal Echo:** records player actions; replaying copy reproduces movement + attacks; interacts with designated mechanisms; distinct look; expires.
- **Timeline Shift:** structured environment states; updates geometry, collision, lighting, atmosphere; keeps the player in a valid position; powers puzzles.
- **Temporal Counter:** precisely timed defence opens a tactical window and a special follow-up.
Temporal energy/stability resource; no infinite exploits; bosses stay challenging without disabling learned abilities. These are mechanics, not visual filters.

## Controller, camera, physics (premium feel)
Smooth camera-relative movement, responsive acceleration, natural deceleration, jump/land, reliable collision, stable grounding, air control, combat movement, animation integrated with physics.
Rapier fixed-timestep, collision layers, trigger volumes, slopes, stairs, moving platforms, dynamic objects, hazards. Camera: exploration, lock-on, target switching, boss framing, collision avoidance,
cinematic transitions, controlled shake, adjustable sensitivity. Avoid camera clipping/snapping/over-shake, floating characters, physics jitter, unresponsive controls. **A beautiful game with poor combat feel is unacceptable.**
