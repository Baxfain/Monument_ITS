import { WORLD_WIND_DIRECTIONS } from "./wind.js";
import { LookInputFilter } from "./look-input.js";

const ACTION_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ShiftLeft", "ShiftRight",
  "ControlLeft", "ControlRight",
  "Space",
]);

export class InputController {
  constructor({ canvas, startButton, camera, wind, onWindChange, onStatus }) {
    this.canvas = canvas;
    this.startButton = startButton;
    this.camera = camera;
    this.wind = wind;
    this.onWindChange = onWindChange;
    this.onStatus = onStatus;
    this.keys = new Set();
    this.locked = false;
    this.jumpQueued = false;
    this.movementCodes = ACTION_CODES;
    this.lookInputFilter = new LookInputFilter();

    this.startButton.addEventListener("click", () => this.requestPointerLock());
    this.canvas.addEventListener("click", () => {
      if (!this.locked) this.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", (event) => this.handleLockChange(event));
    document.addEventListener("pointerlockerror", (event) => {
      this.clearMovementState(event.timeStamp);
      this.onStatus("Pointer lock was not granted. Click Start walkthrough to try again.");
    });
    document.addEventListener("mousemove", (event) => {
      if (!this.locked || !event.isTrusted) return;
      const movement = this.lookInputFilter.sample(event.movementX, event.movementY, event.timeStamp);
      if (movement.accepted) this.camera.rotate(movement.x, movement.y);
    });
    document.addEventListener("keydown", (event) => this.handleKeyDown(event));
    document.addEventListener("keyup", (event) => this.handleKeyUp(event));
    window.addEventListener("blur", (event) => this.clearMovementState(event.timeStamp));
    window.addEventListener("focus", (event) => this.clearMovementState(event.timeStamp));
    document.addEventListener("visibilitychange", (event) => {
      if (document.visibilityState === "hidden") this.clearMovementState(event.timeStamp);
    });
  }

  async requestPointerLock() {
    this.clearMovementState();
    if (!this.canvas.requestPointerLock) {
      this.onStatus("Pointer lock is unavailable in this browser. The scene still supports the front comparison view.");
      return;
    }
    try {
      try {
        await this.canvas.requestPointerLock({ unadjustedMovement: true });
      } catch (error) {
        if (error?.name !== "NotSupportedError") throw error;
        this.clearMovementState();
        await this.canvas.requestPointerLock();
      }
    } catch {
      this.clearMovementState();
      this.onStatus("Pointer lock was not granted. Click Start walkthrough to try again.");
    }
  }

  clearMovementState(timestampMs = performance.now()) {
    this.keys.clear();
    this.jumpQueued = false;
    this.camera.cancelJump();
    this.camera.setCrouched(false);
    this.camera.setSprinting(false);
    this.lookInputFilter.reset(timestampMs);
  }

  handleLockChange(event) {
    this.locked = document.pointerLockElement === this.canvas;
    this.clearMovementState(event?.timeStamp);
    if (this.locked) {
      this.canvas.focus({ preventScroll: true });
      this.startButton.textContent = "Walkthrough active · Esc to exit";
      this.onStatus("Pointer locked · Esc releases.");
      return;
    }
    this.startButton.textContent = "Start walkthrough";
    this.onStatus("Pointer released · click Start walkthrough to explore.");
  }

  handleKeyDown(event) {
    const windDirection = WORLD_WIND_DIRECTIONS[event.code];
    if (windDirection) {
      const target = event.target;
      const isFormControl = target instanceof Element && target.closest("input, select, textarea, [contenteditable='true']");
      if (!isFormControl) {
        this.wind.setDirection(windDirection.vector);
        this.onWindChange?.(this.wind.direction);
        event.preventDefault();
      }
      return;
    }
    if (this.locked && event.code === "Escape") {
      document.exitPointerLock?.();
      return;
    }
    if (!this.locked || !ACTION_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.code === "Space") {
      if (!event.repeat && !this.keys.has(event.code)) this.jumpQueued = true;
      this.keys.add(event.code);
      return;
    }
    this.keys.add(event.code);
  }

  handleKeyUp(event) {
    if (ACTION_CODES.has(event.code)) this.keys.delete(event.code);
  }

  update(deltaSeconds) {
    let forward = 0;
    let right = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) right += 1;
    if (this.keys.has("KeyA")) right -= 1;
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const crouch = this.keys.has("ControlLeft") || this.keys.has("ControlRight");
    const jumpPressed = this.jumpQueued;
    this.jumpQueued = false;
    this.camera.update(forward, right, deltaSeconds, { sprint, crouch, jumpPressed });
  }
}
