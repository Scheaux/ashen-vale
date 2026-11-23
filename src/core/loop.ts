/**
 * Fixed-timestep game loop: simulation ticks at a constant rate (deterministic),
 * rendering runs at display rate with interpolation alpha for smooth motion.
 */
export interface LoopHooks {
  /** Called at a fixed rate (simHz) with a constant dt. */
  fixedUpdate(dt: number): void;
  /** Called once per animation frame. alpha is the interpolation factor in [0,1]. */
  render(dt: number, alpha: number, elapsed: number): void;
}

export class GameLoop {
  private readonly simDt: number;
  private accumulator = 0;
  private lastTime = -1;
  private elapsed = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly hooks: LoopHooks,
    simHz = 60,
  ) {
    this.simDt = 1 / simHz;
  }

  start(): void {
    if (this.rafId !== 0) return;
    this.lastTime = -1;
    const frame = (nowMs: number): void => {
      this.rafId = requestAnimationFrame(frame);
      const now = nowMs / 1000;
      if (this.lastTime < 0) this.lastTime = now;
      // Clamp dt to avoid spiral-of-death after tab switches.
      const dt = Math.min(0.1, now - this.lastTime);
      this.lastTime = now;
      this.elapsed += dt;

      if (this.running) {
        this.accumulator += dt;
        while (this.running && this.accumulator >= this.simDt) {
          this.accumulator -= this.simDt;
          this.hooks.fixedUpdate(this.simDt);
        }
      } else {
        this.accumulator = 0;
      }
      this.hooks.render(dt, this.running ? this.accumulator / this.simDt : 1, this.elapsed);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Gate the simulation (paused menus keep rendering). */
  setRunning(running: boolean): void {
    this.running = running;
    if (!running) this.accumulator = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
