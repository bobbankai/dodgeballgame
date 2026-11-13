# Done checklist for a coding task
- `npm run eclipse:typecheck` must pass.
- For gameplay/rendering changes: a headless play.mjs run with screenshots, looked at before claiming it works.
- For Blender/asset changes: rebuild the affected character/kit, check its preview PNG in /opt/eclipse-raw/work, and check the GLB is in public/assets.
- Commit with trailers (Co-Authored-By and Claude-Session lines required by the session), then `git push -u origin claude/loving-mccarthy-dd4uvb`.
- Update eclipse/docs/DEVLOG.md with what was verified and what is not.