import { AudioEngine } from './engine';
import { RECIPES } from './recipes';

/** Offline render of every sound recipe (audio.html): peak, RMS, length above -50 dB, spectral centroid; samples for spectrograms. */
async function main(): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(RECIPES)) {
    const sr = 44100, len = 5;
    const ctx = new OfflineAudioContext(1, sr * len, sr);
    const e = new AudioEngine();
    (e as any).ctx = ctx;
    e.sfx = ctx.createGain(); e.sfx.connect(ctx.destination);
    e.verbIn = ctx.createGain(); // no reverb in the check: the dry design
    RECIPES[name](e, e.out(), 0.05, 1);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0, last = 0, nan = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      if (a > 0.00316) last = i; // -50 dB
    }
    // crude spectral centroid over the first 0.5 s via zero-crossing rate
    let zc = 0;
    for (let i = 1; i < Math.min(d.length, sr / 2); i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++;
    const step = 4;
    const samples = Array.from(d.subarray(0, Math.min(d.length, Math.ceil((last / sr + 0.1) * sr)))).filter((_, i) => i % step === 0);
    out[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), dur: +(last / sr).toFixed(2), zcHz: Math.round(zc), nan, sr: sr / step,
      samples };
  }
  (window as any).__audio = out;
}
void main();
