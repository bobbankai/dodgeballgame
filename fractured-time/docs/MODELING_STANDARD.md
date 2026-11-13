# Modeling Standard (Blender 5.3)

Source: directive §4, §5, §6, §8, §9 and master directive §5. Blender is the primary modeling and animation environment (headless Python + any available MCP).

## Techniques (use what the asset needs)
Detailed mesh modelling, high-poly + sculpting, subdivision, professional bevel workflows, retopology, Geometry Nodes, booleans where appropriate, UV unwrapping,
texture baking (high-to-low normals, AO, curvature, ID, ORM packing), PBR authoring, mesh optimisation. Primitive blockouts are for blockout only; final assets are refined.
Do not ship models that look like unfinished Roblox characters, mannequins or primitive prototypes. Polygon count alone is not quality: shape, design, material detail, refinement.

## Every important model has
Strong silhouette · correct proportions · detailed geometry · proper surface transitions · meaningful secondary detail · realistic material construction · clean topology ·
appropriate UVs · suitable texture resolution · game-ready export. Validate with `blender-asset-qa` (z-fighting, normals, non-manifold, UVs, weights, scale) before calling it done.

## Characters (Ethan, Echo, Nyx, Imani, Voss, HELIX enemies, bosses)
Believable anatomy · carefully modelled faces (defined eyes, **eyelids**, nose, lips, ears, jaw) · quality hairstyles with a believable silhouette (not a flat helmet) · detailed hands + fingers ·
properly shaped limbs · realistic clothing with folds, seams, stitching, thickness and material variation · layered armour that **follows the body (not oversized boxes)** · functional equipment ·
detailed boots/accessories · quality skin materials · facial expressions (rig/morph targets) · animation-friendly topology · proper rigs that deform correctly in motion and combat.
Faces must hold up in cinematic close-ups. Never mark a character complete because geometry exists: review front/back/side/3-4/close-up/gameplay views.

## Environments and props
Kits: underground labs, futuristic streets, skyscraper interiors, rooftops, subway tunnels, research facilities, industrial, Temporal Nexus. Bevels, realistic proportions, layered geometry,
detailed silhouettes, believable construction; no giant primitive blocks as architecture. Props need recognisable silhouettes, believable construction, mechanical detail, bevels, material
separation, imperfections, detailed textures, optimised geometry; interactive props must survive close-ups. Detail by gameplay importance and visibility.

## Asset pipeline
glTF 2.0 / GLB; consistent naming; predictable coordinate system (Blender -Y forward -> three +Z); correct scale (1 unit = 1 m); material validation; texture packing; mesh optimisation
(meshopt/Draco), LOD variants, collision meshes, automated headless exports, validation scripts. **Test every import in Three.js** (materials, rigs, animation); export success proves nothing.

## Materials / textures
Base colour, normal, roughness, metalness, AO, emissive, height where useful. Source high-res where justified; ship textures sized by screen-space importance with KTX2 compression + mipmaps +
efficient UV layouts. Characters currently carry baked albedo+AO in vertex colours (no UVs) with runtime TSL detail: acceptable for enemies/background, **below the standard for hero close-ups**
(see `PROJECT_PROGRESS.md`); hero characters need UVs + baked texture sets.
