/**
 * The name of a recorded line: a hash of who says it and exactly what they say, shared by the
 * recording tool (tools/voices) and the game, so a changed line simply falls back to the babble
 * voice until it is recorded again.
 */
export function lineKey(speaker: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${speaker}|${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A note's words as Mum would read them: no markup, entities spelled out. */
export function noteText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
