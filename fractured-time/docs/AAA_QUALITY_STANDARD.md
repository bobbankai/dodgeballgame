# AAA Quality Standard (workflow, completion, honesty)

Source: `GRAPHICS_DIRECTIVE_PROMPT.md` §1, §2, §25, §26. This is not a prototype; the target is the highest practical quality in every discipline.

## Principles
- Quality means craftsmanship, not more code, polygons or effects. No unnecessary complexity without visual/gameplay benefit.
- Never trade the quality of an important system for speed. Never accept a basic version when a feasible better one clearly improves the game.
- Never substitute primitive assets, generic animation or superficial effects for finished content.
- No silent downgrades of any requirement. If something cannot be met with the available tools: say so accurately, choose the strongest
  feasible alternative, and record the remaining work in `PROJECT_PROGRESS.md`.

## Workflow for every major task
1. Review the applicable requirements (the docs table in `CLAUDE.md`). 2. Inspect the existing project. 3. Establish the intended quality level.
4. Implement. 5. Test functionality. 6. **Inspect the real rendered result.** 7. Correct deficiencies. 8. Update `PROJECT_PROGRESS.md`.

## Completion ladder (track every feature)
`1 Planned > 2 Implemented > 3 Integrated > 4 Tested > 5 Visually reviewed > 6 Polished > 7 Complete`
"Complete" needs evidence: the screenshot/test/measurement that shows it. A chapter is complete only when objectives, interactions, combat,
cinematics, transitions and checkpoints work together end to end.

## Mandatory visual reviews (create the renders, look at them, fix what is wrong)
- **Models:** front, back, side, three-quarter, close-up, gameplay perspective.
- **Environments:** overall composition, architecture, materials, lighting, props, atmosphere, gameplay-camera views.
- **Animations:** full playback, weight, transitions, foot placement, combat timing, deformation, *in the running game* not only in Blender.
- **Combat:** responsiveness, hit detection, animation sync, enemy reactions, defensive timing, boss behaviour.
- Do not assume it looks good because the code runs. Do not claim AAA quality without evaluating the actual result.

## Non-negotiables (any of these present = work is below standard; fix before marking done)
- **Modeling:** primitive-looking final characters, weak geometry, featureless faces, poorly built clothing, unfinished environments.
- **Graphics:** flat lighting, generic materials, weak shadows, excessive post, obvious rendering defects.
- **Animation:** stiff movement, sliding feet, disconnected combat actions, lifeless cinematics, poorly rigged characters.
- **Combat:** button-mashing, inconsistent hit detection, simplistic AI, underdeveloped bosses.
- **Story:** disconnected chapters, meaningless dialogue, missing character development, unfinished cinematics, incomplete endings.
- **Audio:** missing important effects, badly mixed music, unfinished presentation. Placeholder tones are not sound design.
- **Production:** false completion claims, untested systems, hidden placeholder assets, code bloat, forgotten requirements.

## Priority order
1 graphics quality · 2 detailed Blender models/environments · 3 rigging + animation · 4 responsive combat · 5 time manipulation ·
6 intelligent enemies + cinematic bosses · 7 story + cutscenes · 8 shaders/lighting/materials/effects · 9 audio + UI · 10 performance, testing, polish.
