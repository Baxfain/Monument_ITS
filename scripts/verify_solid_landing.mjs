#!/usr/bin/env node
import assert from "node:assert/strict";
import { CONFIG, deriveMonumentLayout } from "../src/config.js";
import { Camera } from "../src/camera.js";
import { CollisionWorld } from "../src/collision.js";
import { createBoxGeometry } from "../src/geometry.js";
import { SceneNode } from "../src/scene-node.js";
import { createScene } from "../src/scene.js";

const FIXED_STEP = 1 / 120;
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

function assertOccupies(world, camera, label) {
  assert.equal(
    world.canOccupy(camera.position[0], camera.position[2], camera.feetY, camera.bodyHeight),
    true,
    `${label}: camera must not overlap a solid collider`,
  );
}

function advance(camera, world, forward, right, frames, modifiers = {}, label = "movement") {
  for (let index = 0; index < frames; index += 1) {
    camera.update(forward, right, FIXED_STEP, {
      ...modifiers,
      jumpPressed: Boolean(modifiers.jumpPressed) && index === 0,
    });
    assertOccupies(world, camera, `${label} frame ${index}`);
  }
}

function moveToBenchApproach(world) {
  const camera = new Camera({ collisionWorld: world });
  camera.yaw = 0;
  advance(camera, world, 0, 1, 296, { sprint: true }, "approach east of bench");
  advance(camera, world, -1, 0, 310, { sprint: true }, "approach behind bench");
  advance(camera, world, 0, -1, 60, { sprint: true }, "line up behind bench");
  near(camera.position[0], 5.03, 0.04, "bench approach X");
  near(camera.position[2], 13.81, 0.04, "bench approach Z");
  return camera;
}

function landOnBenchBack() {
  const world = new CollisionWorld(createScene());
  const camera = moveToBenchApproach(world);
  advance(camera, world, 1, 0, 120, { sprint: true, jumpPressed: true }, "jump onto bench seat");
  const seat = world.colliderByName.get("BenchSeat");
  near(camera.feetY, seat.bounds.maxY, 0.003, "first jump lands on the bench seat");
  assert.equal(camera.grounded, true, "bench seat landing is grounded");

  advance(camera, world, 1, 0, 42, { sprint: true, jumpPressed: true }, "jump over bench back");
  const back = world.colliderByName.get("BenchBack");
  assert.ok(camera.feetY > back.bounds.maxY, "second jump clears the bench back before descent");
  for (let index = 0; index < 120 && !camera.grounded; index += 1) {
    camera.update(0, 0, FIXED_STEP);
    assertOccupies(world, camera, `bench-back descent frame ${index}`);
  }
  assert.equal(camera.grounded, true, "camera lands on the untagged bench-back top");
  near(camera.feetY, back.bounds.maxY, 0.003, "camera rests on the bench-back top");
  assertOccupies(world, camera, "bench-back landing");

  for (let index = 0; index < 60; index += 1) {
    camera.update(0, 0, FIXED_STEP);
    assert.equal(camera.grounded, true, `bench-back rest remains grounded at frame ${index}`);
    near(camera.feetY, back.bounds.maxY, 0.003, `bench-back rest height at frame ${index}`);
    assertOccupies(world, camera, `bench-back rest frame ${index}`);
  }
  return { world, camera, back };
}

function makeSyntheticWorld() {
  const root = new SceneNode({ name: "SyntheticLandingWorld" });
  const box = createBoxGeometry();
  root.add(new SceneNode({
    name: "GroundPlane",
    geometry: box,
    scale: [20, 0.2, 20],
    position: [0, -0.1, 0],
    collision: { surface: true, perimeter: true },
  }));
  root.add(new SceneNode({
    name: "UntaggedSolidTop",
    geometry: box,
    scale: [1.2, 0.2, 1.2],
    position: [0, 0.1, CONFIG.camera.startPosition[2]],
    collision: { solid: true },
  }));
  return new CollisionWorld(root);
}

const synthetic = makeSyntheticWorld();
const platform = synthetic.colliderByName.get("UntaggedSolidTop");
const syntheticLanding = synthetic.resolveVertical(
  0,
  CONFIG.camera.startPosition[2],
  1,
  -0.2,
  CONFIG.camera.standingBodyHeight,
  CONFIG.camera.collisionRadius,
);
near(syntheticLanding.feetY, platform.bounds.maxY, 1e-5, "synthetic fall lands on untagged solid top");
assert.equal(syntheticLanding.grounded, true, "synthetic solid top reports grounded");
assert.equal(synthetic.canOccupy(0, CONFIG.camera.startPosition[2], syntheticLanding.feetY, CONFIG.camera.standingBodyHeight), true);
const syntheticSupport = synthetic.findSurface(
  0,
  CONFIG.camera.startPosition[2],
  CONFIG.camera.collisionRadius,
  platform.bounds.maxY - 0.001,
  platform.bounds.maxY + 0.001,
);
assert.equal(syntheticSupport?.name, "UntaggedSolidTop", "solid top participates in grounded support queries");

const monumentLayout = deriveMonumentLayout(CONFIG.monument);
const monumentWorld = new CollisionWorld(createScene());
const pedestalLayers = [
  ["PlaqueBearingMainBody", monumentLayout.mainBody],
  ["IvoryBand", monumentLayout.band],
  ["GrayStoneNeckBlock", monumentLayout.neck],
  ["BlackPolishedCap", monumentLayout.cap],
];
for (const [name, layout] of pedestalLayers) {
  const collider = monumentWorld.colliderByName.get(name);
  assert.ok(collider, `${name} registers a solid collider`);
  near(collider.bounds.maxY, layout.topY, 1e-6, `${name} collision top follows its derived layer top`);
  if (name === "BlackPolishedCap") {
    near(collider.bounds.minX, -CONFIG.monument.cap.size[0] / 2, 1e-6, "cap collision left edge follows its front width");
    near(collider.bounds.maxX, CONFIG.monument.cap.size[0] / 2, 1e-6, "cap collision right edge follows its front width");
    near(collider.bounds.minZ, -CONFIG.monument.cap.size[2] / 2, 1e-6, "cap collision rear edge follows its reduced depth");
    near(collider.bounds.maxZ, CONFIG.monument.cap.size[2] / 2, 1e-6, "cap collision front edge follows its reduced depth");
  }
  const support = monumentWorld.findSurface(0, 0, 0.01, layout.topY - 0.001, layout.topY + 0.001);
  assert.equal(support?.name, name, `${name} top participates in walkable surface queries`);
}
assert.equal(
  monumentWorld.canOccupy(0, 0, monumentLayout.neck.bottomY + 0.02, 0.1, 0.02),
  false,
  "the inserted stone neck blocks a body from passing through its solid volume",
);

const syntheticCamera = new Camera({ collisionWorld: synthetic });
near(syntheticCamera.feetY, platform.bounds.maxY, 1e-5, "safe spawn recognizes the synthetic solid top");
for (let index = 0; index < 60; index += 1) {
  syntheticCamera.update(0, 0, FIXED_STEP);
  assert.equal(syntheticCamera.grounded, true, `synthetic rest remains grounded at frame ${index}`);
  assertOccupies(synthetic, syntheticCamera, `synthetic rest frame ${index}`);
}

const benchWalkOff = landOnBenchBack();
advance(benchWalkOff.camera, benchWalkOff.world, 0, 1, 180, { sprint: true }, "walk off bench back");
assert.equal(benchWalkOff.camera.grounded, true, "walking off the bench back settles on the ground");
assertOccupies(benchWalkOff.world, benchWalkOff.camera, "after walking off bench back");

const benchJumpOff = landOnBenchBack();
advance(benchJumpOff.camera, benchJumpOff.world, 0, 1, 120, { sprint: true, jumpPressed: true }, "jump off bench back");
for (let index = 0; index < 180 && !benchJumpOff.camera.grounded; index += 1) {
  benchJumpOff.camera.update(0, 0, FIXED_STEP);
  assertOccupies(benchJumpOff.world, benchJumpOff.camera, `jump-off landing frame ${index}`);
}
assert.equal(benchJumpOff.camera.grounded, true, "jumping off the bench back settles on the ground");
assertOccupies(benchJumpOff.world, benchJumpOff.camera, "after jumping off bench back");

process.stdout.write(JSON.stringify({
  synthetic: { landingY: syntheticLanding.feetY, support: syntheticSupport.name },
  pedestalSurfaces: pedestalLayers.map(([name, layout]) => ({ name, topY: layout.topY })),
  bench: {
    seatTopY: benchWalkOff.world.colliderByName.get("BenchSeat").bounds.maxY,
    backTopY: benchWalkOff.back.bounds.maxY,
    walkOff: { x: benchWalkOff.camera.position[0], z: benchWalkOff.camera.position[2], feetY: benchWalkOff.camera.feetY },
    jumpOff: { x: benchJumpOff.camera.position[0], z: benchJumpOff.camera.position[2], feetY: benchJumpOff.camera.feetY },
  },
  result: "passed",
}, null, 2) + "\n");
