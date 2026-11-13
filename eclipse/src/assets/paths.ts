/** Resolves a path under public/assets relative to the page, so the build works from any folder. */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return `${base}assets/${path}`;
}
