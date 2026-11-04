import { CONFIG } from "./config.js";
import { degToRad, Mat4 } from "./math3d.js";

export class Camera {
  constructor({ collisionWorld } = {}) {
    if (!collisionWorld) throw new Error("Camera requires a CollisionWorld.");
    this.collisionWorld = collisionWorld;
    this.eyeHeight = CONFIG.camera.eyeHeight;
    this.bodyHeight = CONFIG.camera.standingBodyHeight;
    this.targetEyeHeight = CONFIG.camera.eyeHeight;
    this.targetBodyHeight = CONFIG.camera.standingBodyHeight;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.crouched = false;
    this.sprinting = false;
    this.aspect = 1;
    this.position = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.reset();
  }

  setAspect(aspect) {
    if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
  }

  rotate(mouseX, mouseY) {
    const sensitivity = CONFIG.camera.mouseRadiansPerPixel;
    this.yaw += mouseX * sensitivity;
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.pitch -= mouseY * sensitivity;
    this.pitch = Math.max(
      degToRad(CONFIG.camera.pitchMinDegrees),
      Math.min(degToRad(CONFIG.camera.pitchMaxDegrees), this.pitch),
    );
  }

  queueJump() {
    this.jumpQueued = true;
  }

  cancelJump() {
    this.jumpQueued = false;
  }

  setCrouched(crouched) {
    this.crouchRequested = Boolean(crouched);
  }

  setSprinting(sprinting) {
    this.sprinting = Boolean(sprinting);
  }

  update(forwardInput, rightInput, deltaSeconds, { sprint = false, crouch = false, jumpPressed = false } = {}) {
    if (jumpPressed) this.queueJump();
    this.crouchRequested = Boolean(crouch);
    this.sprinting = Boolean(sprint) && !this.crouchRequested;

    const dt = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    const stepCount = Math.max(1, Math.ceil(dt / CONFIG.camera.simulationStep));
    const step = stepCount > 0 ? dt / stepCount : 0;
    for (let index = 0; index < stepCount; index += 1) this.#step(step, forwardInput, rightInput);
    this.position[1] = this.feetY + this.eyeHeight;
  }

  #updatePosture(deltaSeconds) {
    const requestedCrouch = Boolean(this.crouchRequested);
    const standingFits = this.collisionWorld.hasHeadroom(
      this.position[0], this.position[2], this.feetY,
      CONFIG.camera.standingBodyHeight,
      CONFIG.camera.collisionRadius,
    );
    this.crouched = requestedCrouch || !standingFits;
    this.targetEyeHeight = this.crouched ? CONFIG.camera.crouchEyeHeight : CONFIG.camera.eyeHeight;
    this.targetBodyHeight = this.crouched ? CONFIG.camera.crouchBodyHeight : CONFIG.camera.standingBodyHeight;
    const amount = 1 - Math.exp(-CONFIG.camera.eyeSmoothingRate * deltaSeconds);
    this.eyeHeight += (this.targetEyeHeight - this.eyeHeight) * amount;
    this.bodyHeight += (this.targetBodyHeight - this.bodyHeight) * amount;
    if (Math.abs(this.eyeHeight - this.targetEyeHeight) < 0.001) this.eyeHeight = this.targetEyeHeight;
    if (Math.abs(this.bodyHeight - this.targetBodyHeight) < 0.001) this.bodyHeight = this.targetBodyHeight;
  }

  #step(deltaSeconds, forwardInput, rightInput) {
    this.#updatePosture(deltaSeconds);

    let forward = forwardInput;
    let right = rightInput;
    const magnitude = Math.hypot(forward, right);
    if (magnitude > 1) {
      forward /= magnitude;
      right /= magnitude;
    }
    const speedMultiplier = this.crouched
      ? CONFIG.camera.crouchMultiplier
      : this.sprinting ? CONFIG.camera.sprintMultiplier : 1;
    const distance = CONFIG.camera.walkingSpeed * speedMultiplier * deltaSeconds;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const deltaX = (sinYaw * forward + cosYaw * right) * distance;
    const deltaZ = (-cosYaw * forward + sinYaw * right) * distance;
    const moved = this.collisionWorld.moveHorizontal(this.position[0], this.position[2], deltaX, deltaZ, {
      feetY: this.feetY,
      bodyHeight: this.bodyHeight,
      radius: CONFIG.camera.collisionRadius,
      maxStepHeight: CONFIG.camera.maxStepHeight,
    });
    this.position[0] = moved.x;
    this.position[2] = moved.z;
    this.feetY = moved.feetY;

    const support = this.collisionWorld.findSurface(
      this.position[0], this.position[2], CONFIG.camera.collisionRadius,
      this.feetY - CONFIG.camera.maxStepDown,
      this.feetY + CONFIG.camera.maxStepHeight,
    );
    if (this.grounded) {
      if (support && support.y >= this.feetY - CONFIG.camera.maxStepDown) {
        if (support.y <= this.feetY + CONFIG.camera.maxStepHeight) this.feetY = support.y;
      } else {
        this.grounded = false;
      }
    }

    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (this.grounded) {
        this.grounded = false;
        this.verticalVelocity = CONFIG.camera.jumpVelocity;
      }
    }

    if (!this.grounded) {
      const oldFeetY = this.feetY;
      this.verticalVelocity -= CONFIG.camera.gravity * deltaSeconds;
      const proposedFeetY = this.feetY + this.verticalVelocity * deltaSeconds;
      const vertical = this.collisionWorld.resolveVertical(
        this.position[0], this.position[2], oldFeetY, proposedFeetY,
        this.bodyHeight, CONFIG.camera.collisionRadius,
      );
      this.feetY = vertical.feetY;
      if (vertical.grounded) {
        this.grounded = true;
        this.verticalVelocity = 0;
      } else if (vertical.hitHead) {
        this.verticalVelocity = 0;
      }
    }
  }

  move(forwardInput, rightInput, deltaSeconds, modifiers = {}) {
    this.update(forwardInput, rightInput, deltaSeconds, modifiers);
  }

  reset(preset = null) {
    const selected = preset ?? {
      position: CONFIG.camera.startPosition,
      yaw: CONFIG.camera.startYaw,
      pitch: CONFIG.camera.startPitch,
    };
    const spawn = this.collisionWorld.findSafeSpawn(
      selected.position[0], selected.position[2],
      CONFIG.camera.collisionRadius, CONFIG.camera.standingBodyHeight,
    );
    this.feetY = spawn.feetY;
    this.position = [spawn.x, spawn.feetY + CONFIG.camera.eyeHeight, spawn.z];
    this.eyeHeight = CONFIG.camera.eyeHeight;
    this.bodyHeight = CONFIG.camera.standingBodyHeight;
    this.targetEyeHeight = CONFIG.camera.eyeHeight;
    this.targetBodyHeight = CONFIG.camera.standingBodyHeight;
    this.yaw = selected.yaw ?? CONFIG.camera.startYaw;
    this.pitch = selected.pitch ?? CONFIG.camera.startPitch;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.crouched = false;
    this.crouchRequested = false;
    this.sprinting = false;
    this.jumpQueued = false;
  }

  getForward() {
    const cosPitch = Math.cos(this.pitch);
    return [
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    ];
  }

  viewMatrix() {
    const forward = this.getForward();
    const target = [
      this.position[0] + forward[0],
      this.position[1] + forward[1],
      this.position[2] + forward[2],
    ];
    return Mat4.lookAt(this.position, target, [0, 1, 0]);
  }

  projectionMatrix() {
    return Mat4.perspective(
      degToRad(CONFIG.renderer.verticalFovDegrees),
      this.aspect,
      CONFIG.renderer.near,
      CONFIG.renderer.far,
    );
  }
}
