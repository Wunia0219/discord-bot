const WINDOW_MS = 60000;
const ATTEMPT_LIMIT = 120;
const FAILURE_LIMIT = 10;

// Discord/tunnel peers can be shared by many players. Use a bounded service-wide
// budget, not untrusted forwarding headers or a separate bucket for every code.
export class LoginRateLimit {
  constructor({ clock = () => performance.now() } = {}) {
    this.clock = clock;
    this.attempts = [];
    this.failures = [];
    this.blockedUntil = 0;
  }

  take() {
    const now = this.clock();
    this.attempts = this.attempts.filter(time => time > now - WINDOW_MS);
    this.failures = this.failures.filter(time => time > now - WINDOW_MS);
    let until = this.blockedUntil;
    for (const [times, limit] of [[this.attempts, ATTEMPT_LIMIT], [this.failures, FAILURE_LIMIT]]) {
      if (times.length >= limit) until = Math.max(until, times[times.length - limit] + WINDOW_MS);
    }
    if (until > now) return until - now;
    this.attempts.push(now);
    return 0;
  }

  failed() {
    this.failures.push(this.clock());
  }

  defer(milliseconds) {
    this.blockedUntil = Math.max(this.blockedUntil, this.clock() + milliseconds);
  }
}
