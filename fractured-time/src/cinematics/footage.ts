/**
 * Recovered footage on screen: an in-engine recording (captured from the game, graded like a security camera) played in a CRT frame
 * over the scene, with the camera's burned-in caption. Resolves when the clip ends (or after its length if it cannot play).
 */
export function playFootage(src: string, caption: string): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/`.replace(/\/\/+/g, '/');
  const wrap = document.createElement('div');
  wrap.className = 'footage';
  wrap.innerHTML = `<div class="ft-frame"><video muted playsinline></video><div class="ft-scan"></div><div class="ft-cap">${caption}</div>
    <div class="ft-rec">&#9679; REC</div></div>`;
  document.body.appendChild(wrap);
  const v = wrap.querySelector('video') as HTMLVideoElement;
  v.src = base + src;
  requestAnimationFrame(() => wrap.classList.add('on'));
  return new Promise((resolve) => {
    const done = () => { wrap.classList.remove('on'); setTimeout(() => wrap.remove(), 700); resolve(); };
    v.addEventListener('ended', done, { once: true });
    v.addEventListener('error', () => setTimeout(done, 6000), { once: true });
    void v.play().catch(() => setTimeout(done, 6000));
  });
}
