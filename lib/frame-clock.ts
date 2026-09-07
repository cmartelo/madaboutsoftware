/** Fixed simulation ticks with no catch-up work from menus or suspended frames. */
export class FrameClock {
  private last: number | null = null;
  private remainder = 0;
  private tick: number;

  constructor(tick: number) {
    this.tick = tick;
  }

  reset() {
    this.last = null;
    this.remainder = 0;
  }

  advance(now: number, playing: boolean) {
    if (!playing) {
      this.reset();
      return { steps: 0, alpha: 1 };
    }
    const delta =
      this.last === null ? 0 : Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.remainder += Math.min(delta, this.tick);
    const steps = Math.floor((this.remainder + 1e-10) / this.tick);
    this.remainder = Math.max(0, this.remainder - steps * this.tick);
    return { steps, alpha: this.remainder / this.tick };
  }
}

export const interpolate = (previous: number, current: number, alpha: number) =>
  previous + (current - previous) * alpha;
