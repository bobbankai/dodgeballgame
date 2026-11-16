# Chapter flow tests

Each script drives a chapter from its start to its completion flag through `tools/play.cjs` (the game in `?test` mode, the
simulation stepped by hand): objectives, timeline shifts, plates and gates, interactions, fights (`KA()` kills every spawned
enemy, wave after wave) and each boss phase (`BH(n)` deals n damage), ending on `chapterN_complete` (Chapter 5: the choice, then
an ending). Run them against a static build (`npx vite build --outDir <dir>` served on its own port), since source edits reload
the dev server:

    node tools/play.cjs "http://localhost:5190/?test&chapter=3&quality=balanced&fast" out/ch3 tests/scripts/flows/ch3_flow.json webgl 640 360

`ch5_end1.json` / `ch5_end2.json` start at the Voss beat (`&at=voss`) and take Ending A / Ending B.
Helpers defined by the first step: `O()` the visible objective (a cleared objective fades but keeps its text), `U(cond, n)` step
until cond or n ticks, `T(x, z, yaw, y)` teleport, `K()` / `KA()` kill, `BH(n)` / `BOSS()` boss damage / handle, `SH(t)` shift.
