#!/usr/bin/env node
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { Camera } from "../src/camera.js";
import { LookInputFilter } from "../src/look-input.js";
import { formatCameraPosition } from "../src/hud.js";

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

const filter = new LookInputFilter();
filter.reset(1000);
const observedPointerLockJump = filter.sample(600, -191, 1023);
assert.equal(observedPointerLockJump.accepted, false, "the reproduced pointer-lock transition spike is rejected");
assert.equal(observedPointerLockJump.reason, "spike");

const bigSyntheticSpike = filter.sample(12000, -18000, 1031);
assert.equal(bigSyntheticSpike.accepted, false, "oversized mouse deltas are rejected without reaching camera rotation");

const hardEventCeiling = new LookInputFilter();
hardEventCeiling.reset(1000);
const malformedBeyondEventCeiling = hardEventCeiling.sample(4097, 0, 2000);
assert.equal(malformedBeyondEventCeiling.accepted, false, "the absolute event ceiling rejects malformed deltas after a long interval too");
assert.equal(malformedBeyondEventCeiling.reason, "spike");

const outOfOrder = filter.sample(8, 4, 1029);
assert.equal(outOfOrder.accepted, false, "out-of-order movement timestamps are rejected");
assert.equal(outOfOrder.reason, "out-of-order");
assert.equal(filter.lastTimestamp, 1031, "an old event cannot move the timing anchor backward");
const afterOutOfOrder = filter.sample(8, 4, 1032);
assert.equal(afterOutOfOrder.accepted, true, "valid input resumes from the last monotonic timestamp");

const backwardTimeExploit = new LookInputFilter();
backwardTimeExploit.reset(1000);
assert.equal(backwardTimeExploit.sample(8, 4, 1010).accepted, true, "a valid sample advances the event-time anchor");
assert.equal(backwardTimeExploit.sample(8, 4, 1000).accepted, false, "a backward timestamp is discarded");
assert.equal(backwardTimeExploit.lastTimestamp, 1010, "the backward sample cannot rewind the anchor");
backwardTimeExploit.reset(1000);
assert.equal(backwardTimeExploit.lastTimestamp, 1010, "a lifecycle reset with an old timestamp cannot rewind the anchor");
const suspiciousAfterBackwardTime = backwardTimeExploit.sample(100, 0, 1011);
assert.equal(suspiciousAfterBackwardTime.accepted, false, "a 100 px packet after the old event is still rate-limited");
assert.equal(suspiciousAfterBackwardTime.reason, "spike");
assert.equal(backwardTimeExploit.lastTimestamp, 1011, "a rejected current-time packet advances the monotonic anchor");
assert.equal(backwardTimeExploit.sample(4, -3, 1012).accepted, true, "normal movement recovers after a rejected packet");

const tiedTimestampFilter = new LookInputFilter();
tiedTimestampFilter.reset(3000);
const tiedPointerLockJump = tiedTimestampFilter.sample(600, -191, 3000);
assert.equal(tiedPointerLockJump.accepted, false, "a tied timestamp cannot bypass the rate filter");
assert.equal(tiedPointerLockJump.reason, "spike");
const tiedSmallMovement = tiedTimestampFilter.sample(4, -2, 3000);
assert.equal(tiedSmallMovement.accepted, true, "small high-frequency input survives tied timestamps");
assert.deepEqual([tiedSmallMovement.x, tiedSmallMovement.y], [4, -2]);

const firstSampleFilter = new LookInputFilter();
const firstUninitializedJump = firstSampleFilter.sample(600, -191, 0);
assert.equal(firstUninitializedJump.accepted, false, "the first uninitialized event uses its bounded time window");
assert.equal(firstUninitializedJump.reason, "spike");
assert.equal(firstSampleFilter.lastTimestamp, 0, "the first finite timestamp initializes the anchor even on rejection");
assert.equal(firstSampleFilter.sample(2, -1, 0).accepted, true, "small first-window tied input remains responsive");

const intentionalHalfTurn = new LookInputFilter();
intentionalHalfTurn.reset(4000);
const halfTurnPixels = Math.PI / CONFIG.camera.mouseRadiansPerPixel;
const halfTurnSample = intentionalHalfTurn.sample(halfTurnPixels, 0, 4100);
assert.equal(halfTurnSample.accepted, true, "a deliberate 180 degree turn over 100 ms remains possible");
near(halfTurnSample.x * CONFIG.camera.mouseRadiansPerPixel, Math.PI, 1e-9, "180 degree turn pixel budget");

const missingRawMovement = filter.sample(undefined, undefined, 1033);
assert.equal(missingRawMovement.accepted, false, "unsupported raw movement fields fail closed");
assert.equal(missingRawMovement.reason, "invalid");
assert.equal(filter.lastTimestamp, 1032, "invalid raw movement cannot change the timing anchor");
assert.equal(filter.sample(Number.NaN, 0, 1033).accepted, false, "non-finite movement is rejected");
assert.equal(filter.sample(0, 0, Number.POSITIVE_INFINITY).accepted, false, "non-finite event timestamps are rejected");
assert.equal(filter.lastTimestamp, 1032, "non-finite input cannot change the timing anchor");

filter.reset(1100);
const quickIntentionalTurn = filter.sample(180, -60, 1120);
assert.deepEqual(quickIntentionalTurn, { x: 180, y: -60, accepted: true, reason: "movement" });

const highDpiSmallMoves = new LookInputFilter();
highDpiSmallMoves.reset(2000);
const highDpiSamples = [1, -2, 3, -1, 2].map((x, index) => highDpiSmallMoves.sample(x, -x, 2001 + index * 2));
assert.ok(highDpiSamples.every((sample) => sample.accepted), "small high-frequency deltas are not smoothed or dropped");
near(highDpiSamples.reduce((sum, sample) => sum + sample.x, 0), 3, 1e-9, "small mouse deltas are preserved exactly");

const groupedEvents = (frameIntervalMs) => {
  const eventFilter = new LookInputFilter();
  eventFilter.reset(0);
  const events = [[12, 45, -18], [24, -12, 24], [36, 90, 0], [48, -30, -15]];
  let elapsedFrames = frameIntervalMs;
  let nextEvent = 0;
  let x = 0;
  let y = 0;
  while (nextEvent < events.length) {
    while (nextEvent < events.length && events[nextEvent][0] <= elapsedFrames) {
      const [timestamp, dx, dy] = events[nextEvent];
      const result = eventFilter.sample(dx, dy, timestamp);
      if (result.accepted) {
        x += result.x;
        y += result.y;
      }
      nextEvent += 1;
    }
    elapsedFrames += frameIntervalMs;
  }
  return [x, y];
};
assert.deepEqual(groupedEvents(1000 / 30), groupedEvents(1000 / 60), "look filtering is independent of frame cadence");
assert.deepEqual(groupedEvents(1000 / 60), groupedEvents(1000 / 144), "look filtering is independent of frame cadence");

const mockCollisionWorld = {
  findSafeSpawn: (x, z) => ({ x, z, feetY: 0 }),
  hasHeadroom: () => true,
  moveHorizontal: (x, z, dx, dz, { feetY }) => ({ x: x + dx, z: z + dz, feetY }),
  findSurface: () => ({ y: 0 }),
  resolveVertical: (_x, _z, _oldFeetY, nextFeetY) => ({ feetY: nextFeetY, grounded: false, hitHead: false }),
};
const yawCamera = new Camera({ collisionWorld: mockCollisionWorld });
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  for (const pitch of [-1.1, 1.1]) {
    yawCamera.reset({ position: [0, CONFIG.camera.eyeHeight, 0], yaw, pitch });
    const start = [...yawCamera.position];
    yawCamera.update(1, 0, 0.2);
    near(yawCamera.position[0] - start[0], Math.sin(yaw) * CONFIG.camera.walkingSpeed * 0.2, 1e-6, `W movement X at yaw ${yaw}`);
    near(yawCamera.position[2] - start[2], -Math.cos(yaw) * CONFIG.camera.walkingSpeed * 0.2, 1e-6, `W movement Z at yaw ${yaw}`);
  }
}

yawCamera.reset({ position: [0, CONFIG.camera.eyeHeight, 0], yaw: Math.PI - 0.01, pitch: 0 });
const beforeWrap = yawCamera.getForward();
yawCamera.rotate(10, 0);
const afterWrap = yawCamera.getForward();
near(beforeWrap.reduce((sum, component, index) => sum + component * afterWrap[index], 0), 1, 0.001, "yaw wrap does not change view direction");

yawCamera.reset({ position: [0, CONFIG.camera.eyeHeight, 0], yaw: 0.4, pitch: 0 });
yawCamera.rotate(25, -1000);
near(yawCamera.pitch * 180 / Math.PI, CONFIG.camera.pitchMaxDegrees, 1e-6, "upward pitch clamps");
near(yawCamera.yaw, 0.4 + 25 * CONFIG.camera.mouseRadiansPerPixel, 1e-9, "pitch clamp preserves yaw movement");
const yawAtUpperPitch = yawCamera.yaw;
yawCamera.rotate(0, 10000);
near(yawCamera.pitch * 180 / Math.PI, CONFIG.camera.pitchMinDegrees, 1e-6, "downward pitch clamps");
near(yawCamera.yaw, yawAtUpperPitch, 1e-9, "pitch clamping does not affect yaw");

assert.equal(formatCameraPosition([-0.0001, 1.536, 7.2]), "X 0.00 · Y 1.54 · Z 7.20", "coordinate HUD uses stable precision without negative zero");

process.stdout.write(JSON.stringify({
  observedPointerLockJump,
  bigSyntheticSpike,
  malformedBeyondEventCeiling,
  outOfOrder,
  afterOutOfOrder,
  backwardTimeExploit: { suspiciousAfterBackwardTime, recovered: true },
  tiedPointerLockJump,
  tiedSmallMovement,
  firstUninitializedJump,
  halfTurnPixels,
  missingRawMovement,
  quickIntentionalTurn,
  preservedHighDpiSamples: highDpiSamples.length,
  frameCadences: [30, 60, 144],
  yawRelativeDirections: 8,
  yawWrapPreserved: true,
  pitchClampPreservedYaw: true,
  coordinateFormat: formatCameraPosition([-0.0001, 1.536, 7.2]),
  result: "passed",
}, null, 2) + "\n");
