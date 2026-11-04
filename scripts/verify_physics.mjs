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
const scene = createScene();
const world = new CollisionWorld(scene);
const radius = CONFIG.camera.collisionRadius;
const standingHeight = CONFIG.camera.standingBodyHeight;

near(world.mapBounds.minX, -30, 1e-5, "ground west edge comes from rendered geometry");
near(world.mapBounds.maxX, 30, 1e-5, "ground east edge comes from rendered geometry");
near(world.mapBounds.minZ, -30, 1e-5, "ground south edge comes from rendered geometry");
near(world.mapBounds.maxZ, 30, 1e-5, "ground north edge comes from rendered geometry");
assert.equal(world.colliderByName.has("GroundPlane"), false, "grass is a walkable surface, not a wall");
const buildingPartName = /^(?:MainBuildingMass|BlueGlazedFacade|EastBuildingWing|RoofSlab|WhiteBuildingSupport|HorizontalSilverLouver|BlueWayfindingSign|SignPanel|SignTopLine|SignMiddleLine|SignLowerLine)/;
assert.equal(world.colliders.some((collider) => buildingPartName.test(collider.name)), false, "rear building and attached details add no solid colliders");
assert.equal(world.surfaces.some((surface) => buildingPartName.test(surface.name)), false, "rear building and attached details add no walkable surfaces");
assert.equal(world.colliderByName.has("PlinthStepLower"), true);
assert.equal(world.colliders.some((collider) => collider.name === "TreeTrunk"), true);
assert.equal(world.colliders.some((collider) => collider.name === "BenchSeat"), true);
assert.equal(world.colliders.some((collider) => collider.name.startsWith("WindLeafSet")), false);
assert.equal(world.colliders.some((collider) => collider.name === "GroundPlane" || collider.name === "ParkRoad"), false);
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

function supportAt(x, z, sampleRadius = radius) {
  const support = world.findSurface(x, z, sampleRadius);
  assert.ok(support, `a walkable surface supports (${x}, ${z})`);
  return support;
}

function cameraAt(x, z, yaw = 0) {
  const support = supportAt(x, z);
  const camera = new Camera({ collisionWorld: world });
  camera.reset({ position: [x, support.y + CONFIG.camera.eyeHeight, z], yaw, pitch: 0 });
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

const plaza = CONFIG.plaza;
const roadY = plaza.entrance.roadTopY;
const paverY = plaza.paverTopY;
const soilY = CONFIG.plants.soilSurfaceY;
const lawnY = plaza.islandLawnTopY;
const roadSupport = supportAt(-8.79, 4);
near(roadSupport.y, roadY, 0.002, "dark roadway blocks support the camera at road height");
const soilSupport = supportAt(-6.0, 6.1);
near(soilSupport.y, soilY, 0.002, "a separate soil pocket supports the camera at its lowered bed height");
const lawnSupport = supportAt(5.3, -5.2);
near(lawnSupport.y, lawnY, 0.002, "the rear-right patchy lawn supports the camera at island height");
const lawnAnnulusSupport = supportAt(3.8, -4.0);
near(lawnAnnulusSupport.y, lawnY, 0.002, "the rear-right lawn stays walkable where it crosses the circular paving radius");
assert.equal(lawnAnnulusSupport.name, "RearRightPatchyLawn", "paving does not take support priority inside the lawn opening");

const curbCrossing = cameraAt(-8.79, 4, Math.PI / 2);
curbCrossing.update(1, 0, 1.5);
assert.ok(curbCrossing.position[0] > -6.6, "walking crosses the segmented outer curb from the west road");
near(curbCrossing.feetY, paverY, 0.01, "the camera settles onto the raised pavers after stepping over the curb");

const lawnPath = world.moveHorizontal(5.3, -5.2, 0.7, 0, {
  feetY: lawnSupport.y,
  bodyHeight: standingHeight,
  radius,
});
near(lawnPath.x, 6.0, 0.004, "grass remains passable across the rear-right lawn");
near(supportAt(lawnPath.x, lawnPath.z).y, lawnY, 0.002, "lawn traversal keeps continuous support");

const roadPath = cameraAt(-8.79, 0, 0);
roadPath.update(1, 0, 0.8);
near(roadPath.position[0], -8.79, 0.003, "road traversal stays in its configured lane");
near(roadPath.feetY, roadY, 0.01, "road traversal keeps a level road support height");

const thresholdSupport = supportAt(0, plaza.entrance.thresholdCenterZ, 0);
near(thresholdSupport.y, paverY, 0.002, "the solid entrance lip supports its raised top");
const rampHighSupport = supportAt(0, plaza.entrance.rampStartZ + 0.01, 0);
const rampLowSupport = supportAt(0, plaza.entrance.rampEndZ - 0.05, 0);
assert.ok(rampHighSupport.y < paverY && rampHighSupport.y > roadY, "the ramp leaves the paver height smoothly");
assert.ok(rampLowSupport.y > roadY - 0.01 && rampLowSupport.y < roadY + 0.03, "the ramp arrives at road height");
const entranceWalkOut = cameraAt(0, 10.3, Math.PI);
entranceWalkOut.update(1, 0, 2.2);
assert.ok(entranceWalkOut.position[2] > 12.7, "the entrance path remains walkable from the island to the road");
near(entranceWalkOut.feetY, roadY, 0.01, "the downhill entrance transition lands on the roadway");
const entranceWalkIn = cameraAt(0, 12.6, 0);
entranceWalkIn.update(1, 0, 2.2);
assert.ok(entranceWalkIn.position[2] < 10.5, "the entrance path remains walkable from the road onto the island");
near(entranceWalkIn.feetY, paverY, 0.01, "the uphill entrance transition reaches the paver elevation");

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

const lawnJumper = cameraAt(5.3, -5.2);
const lawnJumpGround = lawnJumper.feetY;
lawnJumper.update(0, 0, 1 / 120, { jumpPressed: true });
for (let index = 0; index < 180; index += 1) lawnJumper.update(0, 0, 1 / 120);
near(lawnJumper.feetY, lawnJumpGround, 0.002, "a jump lands back on the patchy lawn support surface");
assert.equal(lawnJumper.grounded, true, "the patchy lawn remains a valid landing surface");

const monumentFront = world.moveHorizontal(0, 3, 0, -10, { feetY: supportAt(0, 3).y, bodyHeight: standingHeight, radius });
assert.ok(monumentFront.z > 0.55, "high-displacement move cannot tunnel through monument");
const monumentRear = world.moveHorizontal(0, -3, 0, 10, { feetY: supportAt(0, -3).y, bodyHeight: standingHeight, radius });
assert.ok(monumentRear.z < -0.55, "monument blocks movement from the rear");
const rearTraversal = world.moveHorizontal(0, -11, 0, -10, { feetY: supportAt(0, -11).y, bodyHeight: standingHeight, radius });
assert.ok(rearTraversal.z < -16, "high-displacement movement crosses the former rear building footprint");
const rearWingTraversal = world.moveHorizontal(14, -13, 0, -10, { feetY: supportAt(14, -13).y, bodyHeight: standingHeight, radius });
assert.ok(rearWingTraversal.z < -17, "movement crosses the former east wing footprint");
const grassPath = world.moveHorizontal(-20, -20, 25, 0, { feetY: supportAt(-20, -20).y, bodyHeight: standingHeight, radius });
near(grassPath.x, 5, 0.003, "grass and planting remain passable");

const sliding = world.moveHorizontal(0, 2, 0.4, -2, { feetY: supportAt(0, 2).y, bodyHeight: standingHeight, radius });
assert.ok(sliding.z >= 0.68 && sliding.z < 0.73, "diagonal contact stops at the upper plinth's front face");
assert.ok(sliding.x > 0.38, "diagonal contact preserves motion tangent to the monument face");
assert.equal(world.canOccupy(sliding.x, sliding.z, sliding.feetY, standingHeight, radius), true, "wall sliding ends without penetration");

const rearDiagonalTraversal = world.moveHorizontal(0, -12, 1.2, -4, { feetY: supportAt(0, -12).y, bodyHeight: standingHeight, radius });
assert.ok(rearDiagonalTraversal.z < -15, "diagonal movement crosses the former rear building frontage");
assert.ok(rearDiagonalTraversal.x > 1.1, "movement stays free across the former building frontage");

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
  outerPlazaSupport: {
    roadY,
    soilY,
    lawnY,
    lawnAnnulus: lawnAnnulusSupport,
    paverY,
    curbCrossing: { x: curbCrossing.position[0], feetY: curbCrossing.feetY },
    lawnPath,
    lawnJump: { ground: lawnJumpGround, landed: lawnJumper.feetY },
    entranceWalkOut: { z: entranceWalkOut.position[2], feetY: entranceWalkOut.feetY },
    entranceWalkIn: { z: entranceWalkIn.position[2], feetY: entranceWalkIn.feetY },
    rampSupports: { high: rampHighSupport, low: rampLowSupport },
  },
  monumentStops: [monumentFront.z, monumentRear.z],
  rearTraversal: rearTraversal.z,
  rearWingTraversal: rearWingTraversal.z,
  wallSlides: { monument: sliding, rearDiagonalTraversal },
  plinthLanding,
  lightingDirection: direction,
  result: "passed",
}, null, 2) + "\n");
