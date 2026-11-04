export const WORLD_WIND_DIRECTIONS = {
  ArrowUp: { label: "−Z", vector: [0, -1] },
  ArrowRight: { label: "+X", vector: [1, 0] },
  ArrowDown: { label: "+Z", vector: [0, 1] },
  ArrowLeft: { label: "−X", vector: [-1, 0] },
};

export class WindController {
  constructor(settings) {
    this.direction = [...settings.direction];
    this.amplitude = settings.amplitude;
    this.speed = settings.speed;
    this.time = 0;
    this.paused = false;
  }

  setDirection(direction) {
    const magnitude = Math.hypot(direction[0], direction[1]);
    if (magnitude < 1e-5) return;
    this.direction = [direction[0] / magnitude, direction[1] / magnitude];
  }

  update(deltaSeconds) {
    if (!this.paused) this.time += deltaSeconds;
  }

  togglePaused() {
    this.paused = !this.paused;
    return this.paused;
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
  }
}
