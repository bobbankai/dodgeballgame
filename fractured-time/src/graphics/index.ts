/** FRACTURED TIME rendering engine (see docs/RENDERER.md). */
export { GraphicsSystem } from './core/GraphicsSystem';
export { resources, assetUrl } from './core/resources';
export type { Capabilities, Backend } from './core/capabilities';
export { isTouchDevice, isMobileDevice, defaultPreset } from './core/capabilities';
export { PRESETS, PRESET_NAMES, normalisePreset, type GraphicsSettings, type PresetName } from './config/presets';
export { GRADES, makeGrade, type Grade, type GradeName } from './postprocessing/grade';
export type { LookUniforms } from './postprocessing/look';
export type { DebugView, FogStage } from './postprocessing/FrameGraph';
export * from './materials';
export { weather, setWeather, type WeatherKind } from './atmosphere/weather';
