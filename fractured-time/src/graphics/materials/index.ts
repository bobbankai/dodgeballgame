/** Material system: recipe templates for levels and characters, procedural presets, the material-side quality knobs. */
export { dressCharacter, armour } from './characters';
export { levelMaterial, finishStatic, weatherproof } from './levels';
export { scanned, plain, screen, glass, chronalLight, practical } from './environment';
export { surface, PRESETS as MATERIAL_PRESETS, emissivePanel, chronalEnergy, type SurfaceParams } from './library';
export { water, waterTime } from './water';
export { windowMaterial } from './windows';
export { SkinMaterial } from './skin';
export { materialQuality, setMaterialQuality } from './quality';
export { recipeOf, recipeType, type Recipe } from './recipes';
