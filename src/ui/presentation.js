export const WIN_HOLD_MS = 1600;
export const REEL_SETTLE_MS = 160;
export const REEL_BOUNCE_MS = 190;
const REEL_CELL_MS = 60;
const REEL_START_STEPS = 10, REEL_STOP_STEPS = 2;
export const REEL_STOP_GAP_MS = REEL_STOP_STEPS * REEL_CELL_MS;
export const SYMBOL_POP_MS = 960;

// A bounded strip can cruise for any network delay without choosing a result.
// Crossing a cell boundary replaces only offscreen cells, keeping motion continuous.
export function pendingReelFrame(strip, from, elapsed, cellHeight) {
  const travel = Math.max(0, elapsed) / REEL_CELL_MS;
  const step = Math.floor(travel);
  const wrap = n => ((n % strip.length) + strip.length) % strip.length;
  return { step, names: Array.from({ length: 6 }, (_, row) => strip[wrap(from - step + row - 2)]),
    offset: (travel - step) * cellHeight, speed: cellHeight / REEL_CELL_MS };
}

// Keep presentation speed independent of the length of the payout model's reels.
// Prepare every cell before spinning; the starting and landing windows, including
// their guard cells, come from the actual strip and never change while visible.
export function reelAnimation(strip, from, to, reel, reduced = false) {
  const steps = reduced ? 4 + reel : REEL_START_STEPS + reel * REEL_STOP_STEPS;
  const wrap = n => ((n % strip.length) + strip.length) % strip.length;
  const names = Array.from({ length: steps + 5 }, (_, row) => {
    const stop = row >= steps ? from - steps : to;
    return strip[wrap(stop + row - 2)];
  });
  const stopAt = steps * REEL_CELL_MS + (reduced ? 0 : REEL_SETTLE_MS / 2);
  return { steps, names, stopAt };
}

// Restart the double-pop whenever a winning symbol is displayed, including loop repeats.
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

export function reelSpeed(distance, elapsed, stopAt, reduced = false) {
  if (elapsed >= stopAt) return 0;
  const settle = reduced ? 0 : Math.min(REEL_SETTLE_MS, stopAt);
  const speed = distance / (stopAt - settle / 2);
  return elapsed <= stopAt - settle ? speed : speed * (stopAt - elapsed) / settle;
}

// The original Kemet landing: a downward overshoot, smaller upward rebound,
// then exact alignment. Run after braking while both guard cells still exist.
export function reelBounceOffset(elapsed, cellHeight, reduced = false) {
  if (reduced || elapsed <= 0 || elapsed >= REEL_BOUNCE_MS) return 0;
  const progress = elapsed / REEL_BOUNCE_MS;
  return cellHeight * .17 * Math.sin(progress * Math.PI * 2) * (1 - progress) ** 2;
}

// Normal and quick spins share the same cruise speed, final deceleration and
// reel cadence. Quick stop removes cruise cells, never compresses the landing.
// Waiting for a result already counts toward the normal cruise duration.
export function reelLandingAnimation(strip, to, names, offset, reel, cellHeight, { elapsed = 0, quick = false, reduced = false } = {}) {
  const scroll = -offset / cellHeight, base = Math.floor(scroll), fraction = scroll - base;
  const settle = reduced ? 0 : REEL_SETTLE_MS;
  const firstStop = (reduced ? 4 : REEL_START_STEPS) * REEL_CELL_MS + settle / 2;
  const remaining = quick ? 0 : Math.max(0, firstStop - elapsed);
  const cruiseSteps = Math.max(reduced ? 4 : 3, Math.ceil((remaining - settle / 2) / REEL_CELL_MS - fraction - 1e-8));
  const steps = cruiseSteps + reel * (reduced ? 1 : REEL_STOP_STEPS);
  const shortNames = Array.from({ length: steps + 5 }, (_, row) => strip[((to + row - 2) % strip.length + strip.length) % strip.length]);
  for (let row = 1; row <= 4; row++) shortNames[steps + row] = names[base + row];
  const distance = (steps + fraction) * cellHeight;
  return { names: shortNames, steps: distance / cellHeight, offset: -distance, stopAt: distance / (cellHeight / REEL_CELL_MS) + settle / 2, reduced };
}

export function roundFeedbackTiming(round, tier, minimumDuration = 0) {
  const regularDelay = tier ? (round.milestone ? 9800 : 5200) : round.milestone ? 7000 : round.wins.length ? Math.min(4000, round.wins.length * WIN_HOLD_MS) : 650;
  // Protect the count-up and one full pass of ordinary wins. Big-win and
  // milestone sequences retain their full existing presentation durations.
  const hold = tier ? (round.milestone ? 9000 : 4500) : round.milestone ? 6300 : round.wins.length * WIN_HOLD_MS;
  return { hold, autoDelay: Math.max(0, regularDelay - hold, minimumDuration - hold) };
}

// Owned by the render loop: pausing the scene also pauses win presentation.
// Replacing/clearing a cycle cannot leave delayed callbacks from an old round.
export class WinCycle {
  wins = [];
  index = -1;
  elapsed = 0;
  start(wins, onWin) { this.wins = [...wins]; this.index = -1; this.elapsed = 0; this.onWin = onWin; }
  clear() { this.wins = []; this.index = -1; this.elapsed = 0; this.onWin = null; }
  tick(delta, paused = false) {
    if (paused || !this.wins.length) return;
    if (this.index < 0) { this.index = 0; this.onWin?.(this.wins[0], 0, this.wins.length); return; }
    this.elapsed += delta;
    if (this.elapsed >= WIN_HOLD_MS) {
      this.elapsed %= WIN_HOLD_MS;
      this.index = (this.index + 1) % this.wins.length;
      this.onWin?.(this.wins[this.index], this.index, this.wins.length);
    }
  }
}
