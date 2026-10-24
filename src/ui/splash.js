// Loading window: shows how far the launcher is while it reads versions and servers
document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => cr.win(b.dataset.win)));
let shown = 0, target = 0;
const fg = document.getElementById('fg'), pc = document.getElementById('pc'), t = document.getElementById('t');
function draw() {
  shown += Math.max(0.6, (target - shown) * 0.12);
  if (shown > target) shown = target;
  fg.style.strokeDashoffset = String(289 - 289 * shown / 100);
  pc.textContent = Math.round(shown) + ' %';
  if (shown < target) requestAnimationFrame(draw);
}
cr.on('boot', (d) => { target = Math.max(target, Math.min(100, d.pct || 0)); if (d.text) t.textContent = d.text; requestAnimationFrame(draw); });
target = 4; requestAnimationFrame(draw);
