export const LINE_HOLD_MS = 1600;
export const REEL_SETTLE_MS = 160;
const REEL_CELL_MS = 60;
export const SYMBOL_POP_MS = 960;

// Keep presentation speed independent of the length of the payout model's reels.
// Prepare every cell before spinning; the starting and landing windows, including
// their guard cells, come from the actual strip and never change while visible.
export function reelAnimation(strip, from, to, reel, reduced = false) {
  const steps = reduced ? 4 + reel : 20 + reel * 4;
  const wrap = n => ((n % strip.length) + strip.length) % strip.length;
  const names = Array.from({ length: steps + 5 }, (_, row) => {
    const stop = row >= steps ? from - steps : to;
    return strip[wrap(stop + row - 2)];
  });
  const stopAt = steps * REEL_CELL_MS + (reduced ? 0 : REEL_SETTLE_MS / 2);
  return { steps, names, stopAt };
}

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
export function reelOffset(distance, elapsed, stopAt, reduced = false) {
  if (elapsed >= stopAt) return 0;
  const settle = reduced ? 0 : Math.min(REEL_SETTLE_MS, stopAt);
  const cruiseUntil = stopAt - settle;
  const speed = distance / (stopAt - settle / 2);
  if (elapsed <= cruiseUntil) return -distance + speed * Math.max(0, elapsed);
  // Slow down into alignment while continuing downward, without an upward kick.
  const remaining = (stopAt - elapsed) / settle;
  return -speed * settle / 2 * remaining ** 2;
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
