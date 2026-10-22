const DESKTOP_WIDTH = 1160;
const DESKTOP_HEIGHT = 740;

export function gameLayoutMode(search, touchOnly) {
  const platform = new URLSearchParams(search).get('platform');
  if (platform === 'desktop') return 'desktop';
  if (platform === 'mobile') return 'mobile';
  return touchOnly ? 'mobile' : 'desktop';
}

export function desktopGameScale(width, height) {
  return Math.max(0, Math.min(width / DESKTOP_WIDTH, height / DESKTOP_HEIGHT));
}

export function installResponsiveLayout(host) {
  const touchOnly = matchMedia('(hover: none) and (pointer: coarse)');
  const selectMode = () => {
    document.documentElement.dataset.gameLayout = gameLayoutMode(location.search, touchOnly.matches);
  };
  selectMode();
  touchOnly.addEventListener('change', selectMode);
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    host.style.setProperty('--game-scale', String(desktopGameScale(width, height)));
  });
  observer.observe(host);
  return () => { observer.disconnect(); touchOnly.removeEventListener('change', selectMode); };
}
