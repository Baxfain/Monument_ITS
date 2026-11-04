#!/usr/bin/env node
import assert from "node:assert/strict";
import { CAMERA_PRESETS, CONFIG } from "../src/config.js";
import { Camera } from "../src/camera.js";
import { CollisionWorld } from "../src/collision.js";
import { createScene } from "../src/scene.js";
import { FRAGMENT_SHADER } from "../src/shaders.js";

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};
const world = new CollisionWorld(createScene());
const radius = CONFIG.camera.collisionRadius;
const standingHeight = CONFIG.camera.standingBodyHeight;

near(world.mapBounds.minX, -30, 1e-5, "ground west edge comes from rendered geometry");
near(world.mapBounds.maxX, 30, 1e-5, "ground east edge comes from rendered geometry");
near(world.mapBounds.minZ, -30, 1e-5, "ground south edge comes from rendered geometry");
near(world.mapBounds.maxZ, 30, 1e-5, "ground north edge comes from rendered geometry");
assert.equal(world.colliderByName.has("GroundPlane"), false, "grass is a walkable surface, not a wall");
assert.equal(world.colliderByName.has("MainBuildingMass"), true);
assert.equal(world.colliderByName.has("EastBuildingWing"), true);
assert.equal(world.colliderByName.has("RoofSlab"), true);
assert.equal(world.colliderByName.has("PlinthStepLower"), true);
assert.equal(world.colliders.some((collider) => collider.name === "TreeTrunk"), true);
assert.equal(world.colliders.some((collider) => collider.name === "BenchSeat"), true);
assert.equal(world.colliders.some((collider) => collider.name.startsWith("WindLeafSet")), false);
assert.equal(world.colliders.some((collider) => collider.name === "GroundPlane" || collider.name === "ParkRoad"), false);
near(world.colliderByName.get("MainBuildingMass").bounds.minZ, -15.5, 1e-5, "building bound follows rendered mass");
near(world.colliderByName.get("EastBuildingWing").bounds.maxX, 15.7, 1e-5, "wing bound follows configured geometry");

const clamped = world.clampToMap(100, -100, radius);
near(clamped.x, 30 - radius, 1e-6, "map bound includes body radius");
near(clamped.z, -30 + radius, 1e-6, "map bound includes body radius");

const edgeCases = [
  { name: "east", x: 29.2, z: 0, yaw: Math.PI / 2, dx: "x", sign: 1 },
  { name: "west", x: -29.2, z: 0, yaw: -Math.PI / 2, dx: "x", sign: -1 },
  { name: "north", x: 0, z: -29.2, yaw: 0, dx: "z", sign: -1 },
  { name: "south", x: 0, z: 29.2, yaw: Math.PI, dx: "z", sign: 1 },
  { name: "north-east corner", x: 29.2, z: -29.2, yaw: Math.PI / 4, corner: [1, -1] },
  { name: "south-east corner", x: 29.2, z: 29.2, yaw: 3 * Math.PI / 4, corner: [1, 1] },
  { name: "north-west corner", x: -29.2, z: -29.2, yaw: -Math.PI / 4, corner: [-1, -1] },
  { name: "south-west corner", x: -29.2, z: 29.2, yaw: -3 * Math.PI / 4, corner: [-1, 1] },
];
for (const test of edgeCases) {
  const camera = new Camera({ collisionWorld: world });
  camera.reset({ position: [test.x, CONFIG.camera.eyeHeight, test.z], yaw: test.yaw, pitch: 0 });
  camera.update(1, 0, 0.4, { sprint: true, jumpPressed: true });
  if (test.dx) {
    near(camera.position[test.dx === "x" ? 0 : 2], test.sign * (30 - radius), 0.004, `${test.name} clamp under sprint and jump`);
  } else {
    near(camera.position[0], test.corner[0] * (30 - radius), 0.004, `${test.name} X clamp under sprint and jump`);
    near(camera.position[2], test.corner[1] * (30 - radius), 0.004, `${test.name} Z clamp under sprint and jump`);
  }
  assert.ok(camera.feetY > camera.collisionWorld.mapBounds.minY, `${test.name} jump remains above ground`);
}

function cameraAt(x, z, yaw = 0) {
  const camera = new Camera({ collisionWorld: world });
  camera.reset({ position: [x, CONFIG.camera.eyeHeight, z], yaw, pitch: 0 });
  return camera;
}

const walking = cameraAt(5, 0);
const walkingStart = [...walking.position];
walking.update(1, 0, 1);
const walkingDistance = Math.hypot(walking.position[0] - walkingStart[0], walking.position[2] - walkingStart[2]);
near(walkingDistance, CONFIG.camera.walkingSpeed, 0.003, "walk speed remains the configured base");

const diagonal = cameraAt(5, 0);
const diagonalStart = [...diagonal.position];
diagonal.update(1, 1, 1);
const diagonalDistance = Math.hypot(diagonal.position[0] - diagonalStart[0], diagonal.position[2] - diagonalStart[2]);
near(diagonalDistance, CONFIG.camera.walkingSpeed, 0.003, "diagonal walking is normalized");

const sprint = cameraAt(5, 0);
const sprintStart = [...sprint.position];
sprint.update(1, 0, 1, { sprint: true });
const sprintDistance = Math.hypot(sprint.position[0] - sprintStart[0], sprint.position[2] - sprintStart[2]);
near(sprintDistance, CONFIG.camera.walkingSpeed * CONFIG.camera.sprintMultiplier, 0.004, "sprint multiplier applies");

const crouch = cameraAt(5, 0);
const crouchStart = [...crouch.position];
crouch.update(1, 0, 1, { sprint: true, crouch: true });
const crouchDistance = Math.hypot(crouch.position[0] - crouchStart[0], crouch.position[2] - crouchStart[2]);
near(crouchDistance, CONFIG.camera.walkingSpeed * CONFIG.camera.crouchMultiplier, 0.004, "crouch takes precedence over sprint");
near(crouch.eyeHeight, CONFIG.camera.crouchEyeHeight, 0.002, "crouch lowers eye height smoothly");

const jumper = cameraAt(5, 0);
const jumpGround = jumper.feetY;
jumper.update(0, 0, 1 / 120, { jumpPressed: true });
jumper.update(0, 0, 0.12, { jumpPressed: true });
assert.ok(jumper.feetY > jumpGround + 0.25, "jump leaves the floor");
let jumpApex = jumper.feetY;
let airborneHeightChanged = false;
for (let index = 0; index < 180; index += 1) {
  const before = jumper.feetY;
  jumper.update(0, 0, 1 / 120);
  jumpApex = Math.max(jumpApex, jumper.feetY);
  if (Math.abs(jumper.feetY - before) > 1e-5) airborneHeightChanged = true;
}
near(jumper.feetY, jumpGround, 0.002, "jump lands on the same walkable surface");
assert.equal(jumper.grounded, true);
assert.equal(jumper.jumpQueued, false, "midair repeated press does not queue a second jump");
assert.ok(airborneHeightChanged, "gravity advances the camera with zero movement input");
assert.ok(jumpApex > jumpGround + 0.6 && jumpApex < jumpGround + 0.9, "jump apex is bounded by velocity and gravity");

const monumentFront = world.moveHorizontal(0, 3, 0, -10, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(monumentFront.z > 0.55, "high-displacement move cannot tunnel through monument");
const monumentRear = world.moveHorizontal(0, -3, 0, 10, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(monumentRear.z < -0.55, "monument blocks movement from the rear");
const building = world.moveHorizontal(0, -11, 0, -10, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(building.z > -15, "high-displacement move stops at rear building frontage");
const wing = world.moveHorizontal(14, -13, 0, -10, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(wing.z > -15.2 - radius - 0.01, "east wing blocks movement independently of main mass");
const grassPath = world.moveHorizontal(-20, -20, 25, 0, { feetY: -0.04, bodyHeight: standingHeight, radius });
near(grassPath.x, 5, 0.003, "grass and planting remain passable");

const sliding = world.moveHorizontal(0, 2, 0.4, -2, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(sliding.z >= 0.68 && sliding.z < 0.73, "diagonal contact stops at the upper plinth's front face");
assert.ok(sliding.x > 0.38, "diagonal contact preserves motion tangent to the monument face");
assert.equal(world.canOccupy(sliding.x, sliding.z, sliding.feetY, standingHeight, radius), true, "wall sliding ends without penetration");

const buildingSlide = world.moveHorizontal(0, -12, 1.2, -4, { feetY: -0.04, bodyHeight: standingHeight, radius });
assert.ok(buildingSlide.z > -14.28, "high-displacement diagonal contact stops at the main building frontage");
assert.ok(buildingSlide.x > 1.1, "main building frontage preserves tangential movement");

const plinthLanding = world.resolveVertical(0, 0, 1, 0, standingHeight, radius);
near(plinthLanding.feetY, 0.52, 0.003, "falling movement lands on the highest walkable plinth top");
assert.equal(plinthLanding.grounded, true, "low monument surfaces provide floor contact");

const ceiling = { name: "TestLowCeiling", shape: "box", bounds: { minX: -1, maxX: 1, minY: 1.45, maxY: 1.65, minZ: 6.2, maxZ: 8.2 } };
const crouchedUnderCeiling = cameraAt(0, 7.2);
world.colliders.push(ceiling);
crouchedUnderCeiling.setCrouched(true);
crouchedUnderCeiling.update(0, 0, 0.8);
assert.ok(crouchedUnderCeiling.bodyHeight < 1.24, "crouched body fits below the low ceiling");
crouchedUnderCeiling.setCrouched(false);
crouchedUnderCeiling.update(0, 0, 0.2);
assert.equal(crouchedUnderCeiling.crouched, true, "standing stays blocked beneath a low ceiling");
const ceilingBottom = ceiling.bounds.minY;
crouchedUnderCeiling.setCrouched(true);
crouchedUnderCeiling.update(0, 0, 0.01, { jumpPressed: true });
let highestEye = crouchedUnderCeiling.position[1];
for (let index = 0; index < 100; index += 1) {
  crouchedUnderCeiling.update(0, 0, 1 / 120);
  highestEye = Math.max(highestEye, crouchedUnderCeiling.position[1]);
}
assert.ok(highestEye < ceilingBottom + 0.01, "jump head contact does not pass through the ceiling");
crouchedUnderCeiling.setCrouched(false);
crouchedUnderCeiling.update(0, 0, 0.3);
assert.equal(crouchedUnderCeiling.crouched, true, "release under the ceiling does not push the body through");
world.colliders.splice(world.colliders.indexOf(ceiling), 1);
crouchedUnderCeiling.setCrouched(false);
crouchedUnderCeiling.update(0, 0, 0.8);
assert.equal(crouchedUnderCeiling.crouched, false, "standing resumes after headroom is clear");

crouchedUnderCeiling.setCrouched(true);
crouchedUnderCeiling.queueJump();
crouchedUnderCeiling.verticalVelocity = 2;
crouchedUnderCeiling.reset(CAMERA_PRESETS.front);
assert.equal(crouchedUnderCeiling.grounded, true, "preset reset grounds the camera");
assert.equal(crouchedUnderCeiling.verticalVelocity, 0, "preset reset clears jump velocity");
assert.equal(crouchedUnderCeiling.crouched, false, "preset reset restores standing posture");
assert.equal(crouchedUnderCeiling.jumpQueued, false, "preset reset clears queued jump");

const direction = CONFIG.lighting.direction;
near(Math.hypot(...direction), 1, 0.01, "directional sunlight vector is normalized");
const yaw = CONFIG.camera.startYaw;
const cameraRight = [Math.cos(yaw), 0, Math.sin(yaw)];
assert.ok(direction[0] * cameraRight[0] + direction[2] * cameraRight[2] < 0, "sun projects to the left in the initial front view");
assert.ok(direction[0] < 0 && direction[1] > 0 && direction[2] > 0, "sun direction is southwest-relative");
assert.match(FRAGMENT_SHADER, /u_lightDirection/);
assert.match(FRAGMENT_SHADER, /u_diffuseStrength/);
assert.match(FRAGMENT_SHADER, /if \(u_doubleSided == 1 && !gl_FrontFacing\) normal = -normal;/);
assert.match(FRAGMENT_SHADER, /float specular = normalLight > 0\.0[\s\S]*?: 0\.0;/, "back-lit faces receive no specular highlight");

process.stdout.write(JSON.stringify({
  mapBounds: world.mapBounds,
  colliderCount: world.colliders.length,
  walkableTriangleCount: world.surfaces.length,
  movement: { walkingDistance, diagonalDistance, sprintDistance, crouchDistance },
  jump: { ground: jumpGround, apex: jumpApex, landed: jumper.feetY },
  monumentStops: [monumentFront.z, monumentRear.z],
  buildingStop: building.z,
  wingStop: wing.z,
  wallSlides: { monument: sliding, building: buildingSlide },
  plinthLanding,
  lightingDirection: direction,
  result: "passed",
}, null, 2) + "\n");
