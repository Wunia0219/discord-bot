export class Sound {
  enabled = false;
  context = null;
  async enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    try { this.context ||= new Audio(); await this.context.resume(); this.enabled = this.context.state === 'running'; } catch { this.enabled = false; }
    return this.enabled;
  }
  tone(frequency, duration = .12, delay = 0, volume = .035) {
    if (!this.enabled || !this.context || document.hidden) return;
    const c = this.context, t = c.currentTime + delay;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, t);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .008); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    osc.connect(gain); gain.connect(c.destination); osc.start(t); osc.stop(t + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  stop(index) { this.tone([330, 392, 440, 494, 554][index], .18); }
  win(big) { (big ? [523, 659, 784, 1047, 1318] : [523, 659, 784]).forEach((n, i) => this.tone(n, .5, i * .12, .05)); }
}
