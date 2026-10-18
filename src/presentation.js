export const LINE_HOLD_MS = 1600;
export const BOUNCE_MS = 190;
export const SYMBOL_POP_MS = 960;

// Restart the double-pop whenever a payline is displayed, including loop repeats.
export class WinSymbolPop {
  elapsed = SYMBOL_POP_MS;
  clear() { this.elapsed = SYMBOL_POP_MS; }
  start(reduced = false) { this.elapsed = reduced ? SYMBOL_POP_MS : 0; }
  tick(delta, paused = false, reduced = false) {
    if (reduced) this.elapsed = SYMBOL_POP_MS;
    else if (!paused) this.elapsed = Math.min(SYMBOL_POP_MS, this.elapsed + Math.max(0, delta));
    if (this.elapsed >= SYMBOL_POP_MS) return 1;
    const half = SYMBOL_POP_MS / 2;
    const amplitude = this.elapsed < half ? .16 : .11;
    return 1 + amplitude * Math.sin(Math.PI * (this.elapsed % half) / half) ** 2;
  }
}
export function reelOffset(distance, elapsed, stopAt, cellHeight, reduced = false) {
  if (elapsed < stopAt) return -distance * (1 - Math.max(0, elapsed) / stopAt);
  if (reduced || elapsed >= stopAt + BOUNCE_MS) return 0;
  const p = (elapsed - stopAt) / BOUNCE_MS;
  // Short downward overshoot, smaller upward rebound, then exact alignment.
  return cellHeight * .17 * Math.sin(p * Math.PI * 2) * (1 - p) ** 2;
}

// Owned by the render loop: pausing the scene also pauses line presentation.
// Replacing/clearing a cycle cannot leave delayed callbacks from an old round.
export class WinLineCycle {
  wins = [];
  index = -1;
  elapsed = 0;
  start(wins, onLine) { this.wins = [...wins]; this.index = -1; this.elapsed = 0; this.onLine = onLine; }
  clear() { this.wins = []; this.index = -1; this.elapsed = 0; this.onLine = null; }
  tick(delta, paused = false) {
    if (paused || !this.wins.length) return;
    if (this.index < 0) { this.index = 0; this.onLine?.(this.wins[0], 0, this.wins.length); return; }
    this.elapsed += delta;
    if (this.elapsed >= LINE_HOLD_MS) {
      this.elapsed %= LINE_HOLD_MS;
      this.index = (this.index + 1) % this.wins.length;
      this.onLine?.(this.wins[this.index], this.index, this.wins.length);
    }
  }
}
