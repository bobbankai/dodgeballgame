# Tech stack
- TypeScript (strict), Babylon.js 9.35 (WebGPU, WebGL2 fallback), Havok physics, Recast/Detour navmesh (@recast-navigation 0.44), postprocessing/n8ao libs, Vite 8, vitest 3, typescript 7.
- Blender 5.x as the `bpy` module in /opt/bvenv (Python 3); numpy, PIL, scipy available there. Not the system python.
- Assets: glTF/GLB with WebP textures; Kokoro voices (tools/voices), numpy sfx/score (tools/audio).
- Headless testing uses Chromium from Playwright (preinstalled, do not reinstall).