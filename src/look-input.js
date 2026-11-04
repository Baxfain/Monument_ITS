import { CONFIG } from "./config.js";

/**
 * Accepts each plausible mouse packet whole and drops anomalous packets whole.
 * It never eases input over render frames, so look motion is independent of FPS.
 */
export class LookInputFilter {
  constructor(settings = CONFIG.camera.lookFilter) {
    this.settings = settings;
    // Keep these fields available to the input diagnostics and browser probe.
    this.maxPixelsPerSecond = settings.maxPixelsPerSecond;
    this.maxPixelsPerEvent = settings.maxPixelsPerEvent;
    this.lastTimestamp = null;
  }

  reset(timestampMs) {
    if (!Number.isFinite(timestampMs)) return;
    if (this.lastTimestamp === null || timestampMs >= this.lastTimestamp) this.lastTimestamp = timestampMs;
  }

  sample(x, y, timestampMs) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(timestampMs)) {
      return { x: 0, y: 0, accepted: false, reason: "invalid" };
    }

    const timestamp = timestampMs;
    if (this.lastTimestamp !== null && timestamp < this.lastTimestamp) {
      return { x: 0, y: 0, accepted: false, reason: "out-of-order" };
    }

    const firstSample = this.lastTimestamp === null;
    const elapsedMs = firstSample
      ? this.settings.firstEventWindowMs
      : timestamp === this.lastTimestamp
        ? this.settings.timestampTieFallbackMs
        : timestamp - this.lastTimestamp;
    const magnitude = Math.hypot(x, y);

    // Keep a monotonic event-time anchor even when a valid-time packet is rejected,
    // so the next packet is checked against its actual interval.
    this.lastTimestamp = timestamp;

    if (!Number.isFinite(magnitude) || magnitude > this.settings.maxPixelsPerEvent) {
      return { x: 0, y: 0, accepted: false, reason: "spike" };
    }

    const rateAllowance = this.settings.maxPixelsPerSecond * elapsedMs / 1000;
    const allowedPixels = Math.min(this.settings.maxPixelsPerEvent, rateAllowance);
    if (magnitude > allowedPixels) {
      return { x: 0, y: 0, accepted: false, reason: "spike" };
    }

    return { x, y, accepted: true, reason: "movement" };
  }
}
