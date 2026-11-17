import * as TSL from 'three/tsl';

/**
 * Weather state shared by every material, effect and the sky: how wet exposed surfaces are, how much standing water lies on
 * flat ground, how hard it is raining, how soaked the characters are. Uniforms: a change shows the same frame.
 */
const { uniform } = TSL as any;

/** A float uniform node: `.value` on the CPU, usable in node graphs. */
type FloatUniform = { value: number } & Record<string, any>;

export interface WeatherUniforms {
  /** water film over exposed surfaces (0 dry .. 1 soaked) */
  wet: FloatUniform;
  /** standing water on flat ground (0 none .. 1 flooded) */
  puddles: FloatUniform;
  /** rain intensity (ripples, rivulets, splashes) */
  rain: FloatUniform;
  /** characters: rises in the rain, dries slowly indoors (skin, hair, clothing) */
  soak: FloatUniform;
}

export const weather: WeatherUniforms = {
  wet: uniform(0), puddles: uniform(0), rain: uniform(0), soak: uniform(0),
} as unknown as WeatherUniforms;

export type WeatherKind = 'dry' | 'storm' | 'downpour';

export function setWeather(kind: WeatherKind): void {
  const w = { dry: [0, 0, 0], storm: [0.8, 0.55, 0.6], downpour: [1, 0.85, 1] }[kind];
  weather.wet.value = w[0];
  weather.puddles.value = w[1];
  weather.rain.value = w[2];
}
