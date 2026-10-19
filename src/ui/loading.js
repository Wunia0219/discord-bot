import { mainArt } from './main-art.js';
export function createLoadingScreen() {
  const screen = document.querySelector('#loading');
  screen.querySelector('.loading-logo').innerHTML = mainArt('logo-short.png', 'loading-logo-art');
  const track = screen.querySelector('#loading-track');
  const status = screen.querySelector('#loading-status');
  const started = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let progress = 0;
  let displayed = 0, frame = 0;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  screen.querySelector('#loading-retry').addEventListener('click', () => location.reload());
  function update(value, message) {
    progress = Math.max(progress, Math.min(100, value));
    cancelAnimationFrame(frame);
    const from = displayed, began = performance.now();
    const draw = now => {
      const t = reduced ? 1 : Math.min(1, (now - began) / 550);
      displayed = from + (progress - from) * (1 - (1 - t) ** 3);
      track.setAttribute('aria-valuenow', String(Math.floor(displayed)));
      screen.querySelector('#loading-fill').style.width = `${displayed}%`;
      if (t < 1) frame = requestAnimationFrame(draw);
    };
    draw(began);
    status.textContent = message;
  }
  return {
    update,
    async finish() {
      update(100, '馬戲團已開啟');
      // Let the final fill settle; avoid flashing the screen on a cached visit.
      await wait(reduced ? 0 : Math.max(600, 1400 - (performance.now() - started)));
      screen.classList.add('is-leaving');
      await wait(reduced ? 0 : 450);
      cancelAnimationFrame(frame);
      screen.remove();
      document.querySelector('#app').inert = false;
    },
    fail(message) {
      cancelAnimationFrame(frame);
      screen.classList.add('has-error');
      screen.setAttribute('aria-busy', 'false');
      status.textContent = `暫時無法開啟馬戲團。${message}`;
      screen.querySelector('#loading-retry').title = `${message} 點此重新載入`;
      screen.querySelector('#loading-retry').hidden = false;
    },
  };
}
