#!/usr/bin/env node
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.js";
import { CollisionWorld } from "../src/collision.js";
import { Mat4 } from "../src/math3d.js";
import { SceneNode } from "../src/scene-node.js";
import { createScene } from "../src/scene.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineDirectory = process.env.GRAKOMS_BASELINE_DIR
  ?? join(projectRoot, "docs", "planning", "evidence", "object-space-normalization", "baseline");
const tolerance = 0.00015;
const near = (actual, expected, label, allowedError = tolerance) => {
  assert.ok(Math.abs(actual - expected) <= allowedError, `${label}: expected ${expected}, got ${actual}`);
};

function makeGeometry(values, extra = {}) {
  const positions = new Float32Array(values);
  const vertexCount = positions.length / 3;
  return {
    positions,
    normals: new Float32Array(vertexCount * 3).fill(0.25),
    uvs: new Float32Array(vertexCount * 2).fill(0.5),
    windWeights: new Float32Array(vertexCount).fill(0.75),
    windPhases: new Float32Array(vertexCount).fill(0.125),
    vertexCount,
    ...extra,
  };
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function maximumRestorationError(source, node) {
  let maximum = 0;
  for (let index = 0; index < source.positions.length; index += 3) {
    const restored = transformPoint(
      node.objectToConstruction,
      node.geometry.positions[index],
      node.geometry.positions[index + 1],
      node.geometry.positions[index + 2],
    );
    for (let axis = 0; axis < 3; axis += 1) {
      maximum = Math.max(maximum, Math.abs(restored[axis] - source.positions[index + axis]));
    }
  }
  return maximum;
}

function compareSnapshot(expected, actual, label) {
  if (typeof expected === "number") {
    near(actual, expected, label, tolerance);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${label} remains an array`);
    assert.equal(actual.length, expected.length, `${label} length`);
    expected.forEach((value, index) => compareSnapshot(value, actual[index], `${label}[${index}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${label} remains an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label} keys`);
    for (const key of Object.keys(expected)) compareSnapshot(expected[key], actual[key], `${label}.${key}`);
    return;
  }
  assert.equal(actual, expected, label);
}

const source = makeGeometry([
  -4, 2, 8,
  10, -6, 1,
  3, 9, -2,
  7, 0, 5,
]);
const sourceCopy = new Float32Array(source.positions);
const sharedA = new SceneNode({ name: "SharedA", geometry: source });
const sharedB = new SceneNode({ name: "SharedB", geometry: source });
assert.equal(sharedA.geometry, sharedB.geometry, "shared source meshes reuse one normalized geometry object");
assert.equal(sharedA.objectToConstruction, sharedB.objectToConstruction, "shared source meshes reuse one restoration transform");
assert.notEqual(sharedA.geometry.positions, source.positions, "normalization does not mutate or reuse the construction positions array");
assert.deepEqual(source.positions, sourceCopy, "the source construction positions remain unchanged");
assert.equal(sharedA.geometry.normals, source.normals, "normal data is preserved by reference");
assert.equal(sharedA.geometry.uvs, source.uvs, "UV data is preserved by reference");
assert.equal(sharedA.geometry.windWeights, source.windWeights, "wind weights are preserved by reference");
assert.equal(sharedA.geometry.windPhases, source.windPhases, "wind phases are preserved by reference");
assert.ok([...sharedA.geometry.positions].every((value) => Number.isFinite(value) && value >= -1 && value <= 1));
const syntheticRestoreError = maximumRestorationError(source, sharedA);
assert.ok(syntheticRestoreError < 2e-6, `synthetic geometry restores within float32 precision, error ${syntheticRestoreError}`);
const idempotent = new SceneNode({ name: "Idempotent", geometry: sharedA.geometry });
assert.equal(idempotent.geometry, sharedA.geometry, "normalizing an already prepared geometry is idempotent");
assert.equal(idempotent.objectToConstruction, sharedA.objectToConstruction, "idempotence preserves the same restoration transform");

const initialReplacementSource = makeGeometry([10, 4, -2, 14, 4, -2, 12, 4, -2], {
  generatorParameters: { width: 4 },
});
const replaceable = new SceneNode({ name: "Replaceable", geometry: initialReplacementSource });
const replaceablePeer = new SceneNode({ name: "ReplaceablePeer", geometry: initialReplacementSource });
const oldSharedGeometry = replaceable.geometry;
const oldSharedPositions = new Float32Array(oldSharedGeometry.positions);
const oldSharedTransform = replaceable.objectToConstruction;
assert.equal(replaceablePeer.geometry, oldSharedGeometry, "unchanged nodes share the original prepared geometry");
const replacementSource = makeGeometry([30, 5, -7, 38, 5, -7, 34, 13, -7], {
  generatorParameters: { width: 8 },
});
replaceable.geometry = replacementSource;
assert.equal(replaceable.geometry.vertexCount, 3, "geometry replacement applies the same preparation contract");
assert.notEqual(replaceable.geometry, oldSharedGeometry, "a new geometry object creates fresh prepared geometry");
assert.equal(replaceable.geometry.generatorParameters.width, 8, "replacement geometry carries its updated parameters");
assert.deepEqual([...replaceable.geometry.positions], [-1, -1, 0, 1, -1, 0, 0, 1, 0], "replacement vertices are normalized from their new bounds");
assert.ok([...replaceable.geometry.positions].every((value) => Number.isFinite(value) && value >= -1 && value <= 1));
assert.ok(maximumRestorationError(replacementSource, replaceable) < 2e-6);
assert.equal(replaceablePeer.geometry, oldSharedGeometry, "replacing one node leaves peers on the old shared geometry");
assert.equal(replaceablePeer.objectToConstruction, oldSharedTransform, "replacing one node leaves peers on the old restoration transform");
assert.deepEqual(oldSharedGeometry.positions, oldSharedPositions, "replacement leaves the old prepared positions unchanged");
assert.equal(oldSharedGeometry.generatorParameters.width, 4, "replacement leaves old shared parameters unchanged");

const emptySource = makeGeometry([]);
const empty = new SceneNode({ name: "Empty", geometry: emptySource });
assert.equal(empty.geometry.vertexCount, 0, "empty meshes remain empty");
assert.deepEqual([...empty.objectToConstruction], [...Mat4.identity()], "empty geometry receives a safe identity restoration transform");

const collisionRegressionRoot = new SceneNode({ name: "EmptyCollisionRegression" });
const perimeterFloorGeometry = makeGeometry([
  -10, 0, -10, 10, 0, -10, 10, 0, 10,
  -10, 0, -10, 10, 0, 10, -10, 0, 10,
], {
  normals: Float32Array.from({ length: 18 }, (_, index) => index % 3 === 1 ? 1 : 0),
});
collisionRegressionRoot.add(new SceneNode({
  name: "ValidPerimeterFloor",
  geometry: perimeterFloorGeometry,
  collision: { perimeter: true, surface: true },
}));
const emptyCollisionParent = collisionRegressionRoot.add(new SceneNode({
  name: "EmptyCollisionParent",
  geometry: makeGeometry([]),
  position: [2, 0, 2],
  scale: [2, 1, 3],
  collision: { solid: true, surface: true, perimeter: true },
}));
const nestedCollisionGeometry = makeGeometry([-1, 0, -1, 1, 0, -1, 0, 0, 1], {
  normals: Float32Array.from({ length: 9 }, (_, index) => index % 3 === 1 ? 1 : 0),
});
emptyCollisionParent.add(new SceneNode({
  name: "NestedChildCollider",
  geometry: nestedCollisionGeometry,
  collision: { solid: true, surface: true },
}));
const emptyCollisionWorld = new CollisionWorld(collisionRegressionRoot, CONFIG.camera);
assert.deepEqual(emptyCollisionWorld.mapBounds, {
  minX: -10, minY: 0, minZ: -10, maxX: 10, maxY: 0, maxZ: 10,
}, "empty perimeter metadata does not replace valid finite map bounds");
assert.ok(Object.values(emptyCollisionWorld.mapBounds).every(Number.isFinite), "empty collision metadata leaves all map bounds finite");
assert.deepEqual(emptyCollisionWorld.colliders.map((collider) => collider.name), ["NestedChildCollider"], "empty solid metadata creates no bogus collider while its child is traversed");
assert.deepEqual(emptyCollisionWorld.colliderByName.get("NestedChildCollider").bounds, {
  minX: 0, minY: 0, minZ: -1, maxX: 4, maxY: 0, maxZ: 5,
}, "a child below empty geometry uses the parent's semantic world transform");
assert.equal(emptyCollisionWorld.colliderByName.has("EmptyCollisionParent"), false, "empty solid geometry is not registered by name");
assert.equal(emptyCollisionWorld.surfaces.length, 3, "valid floor and nested child surfaces are kept without empty-node triangles");
assert.deepEqual(
  emptyCollisionWorld.surfaces.map((surface) => surface.name),
  ["ValidPerimeterFloor", "ValidPerimeterFloor", "NestedChildCollider"],
  "empty surface metadata registers no bogus support triangles",
);
const regressionRadius = CONFIG.camera.collisionRadius;
const regressionClamp = emptyCollisionWorld.clampToMap(100, -100, regressionRadius);
assert.deepEqual(regressionClamp, { x: 10 - regressionRadius, z: -10 + regressionRadius }, "empty perimeter metadata does not poison map clamping");
assert.ok(Number.isFinite(regressionClamp.x) && Number.isFinite(regressionClamp.z), "empty perimeter map clamping stays finite");
const regressionSpawn = emptyCollisionWorld.findSafeSpawn(0, 0, regressionRadius, CONFIG.camera.standingBodyHeight);
assert.ok(Object.values(regressionSpawn).every(Number.isFinite), "valid floor still produces a finite safe spawn");
assert.deepEqual(regressionSpawn, { x: 0, z: 0, feetY: 0 }, "safe spawn uses the valid perimeter floor");

const flatSource = makeGeometry([10, 4, -2, 14, 4, -2, 12, 4, -2]);
const flat = new SceneNode({ name: "Flat", geometry: flatSource });
assert.deepEqual([...flat.geometry.positions], [-1, 0, 0, 1, 0, 0, 0, 0, 0], "flat geometry normalizes without a zero-axis divide");
assert.ok(maximumRestorationError(flatSource, flat) < 2e-6);

const pointSource = makeGeometry([4, 5, 6, 4, 5, 6, 4, 5, 6]);
const point = new SceneNode({ name: "Point", geometry: pointSource });
assert.deepEqual([...point.geometry.positions], [0, 0, 0, 0, 0, 0, 0, 0, 0], "point geometry uses a safe unit fallback radius");
assert.ok(maximumRestorationError(pointSource, point) < 2e-6);

assert.throws(() => new SceneNode({ name: "NonFinite", geometry: makeGeometry([0, 0, 0, Infinity, 0, 0, 0, 1, 0]) }), /finite/);
assert.throws(() => new SceneNode({ name: "Malformed", geometry: { positions: new Float32Array([0, 1]) } }), /XYZ triples/);

const hierarchyRoot = new SceneNode({
  name: "HierarchyRoot", position: [3, -2, 4], rotation: [13, 26, -8], scale: [1.1, 0.9, 1.2],
});
const parentSource = makeGeometry([-2, 1, 0, 3, 4, 1, 0, -1, 5]);
const parent = hierarchyRoot.add(new SceneNode({
  name: "GeometryParent", geometry: parentSource,
  position: [1, 2, -3], rotation: [-9, 17, 4], scale: [2, 0.7, 1.4],
}));
const childSource = makeGeometry([5, -1, 2, 8, 3, 0, 6, 1, 7]);
const child = parent.add(new SceneNode({
  name: "NestedChild", geometry: childSource,
  position: [-4, 0.5, 2], rotation: [7, -31, 11], scale: [0.6, 1.3, 0.8],
}));
const rootSemantic = Mat4.multiply(Mat4.identity(), hierarchyRoot.localMatrix());
const parentSemantic = Mat4.multiply(rootSemantic, parent.localMatrix());
const childSemantic = Mat4.multiply(parentSemantic, child.localMatrix());
assert.deepEqual([...parent.worldMatrix(rootSemantic)], [...parentSemantic], "semantic parent transforms stay unchanged when its mesh is prepared");
assert.deepEqual([...child.worldMatrix(parentSemantic)], [...childSemantic], "child transforms do not inherit the parent's mesh restoration transform");
for (const [sourceGeometry, node, semanticWorld] of [
  [parentSource, parent, parentSemantic],
  [childSource, child, childSemantic],
]) {
  const meshWorld = node.worldGeometryMatrix(node === parent ? rootSemantic : parentSemantic);
  for (let index = 0; index < sourceGeometry.positions.length; index += 3) {
    const expected = transformPoint(semanticWorld, ...sourceGeometry.positions.slice(index, index + 3));
    const actual = transformPoint(meshWorld, ...node.geometry.positions.slice(index, index + 3));
    expected.forEach((coordinate, axis) => near(actual[axis], coordinate, `${node.name} world vertex ${index / 3}.${axis}`, 0.00002));
  }
}

const baselineIndexPath = join(baselineDirectory, "baseline-world-support.json");
const baselineIndex = JSON.parse(readFileSync(baselineIndexPath, "utf8"));
const baselineVertexPath = join(baselineDirectory, "baseline-world-vertices.f64.gz");
const baselineVertexBytes = gunzipSync(readFileSync(baselineVertexPath));
assert.equal(baselineVertexBytes.byteLength, baselineIndex.totalVertices * 3 * 8, "baseline world-vertex snapshot byte length matches its index");
const baselineVertexView = new DataView(baselineVertexBytes.buffer, baselineVertexBytes.byteOffset, baselineVertexBytes.byteLength);
const scene = createScene();
const finalMeshes = [];
const unchangedMeshes = [];
const changedPavementMeshes = [];
const ranges = { min: Infinity, max: -Infinity };
let maxWorldRestorationError = 0;
let floatOffset = 0;
const changedPavementName = /^(?:SquarePavingApron|CircularPavingApron|ApronTileSurfaces|ApronGroutSurface|ApronSide(?:North|South|East|West))$/;
const stablePath = (path) => path.replace(/\[\d+\]/g, "");
const isChangedFootPavementPath = (path) => {
  const normalizedPath = stablePath(path);
  const name = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  return normalizedPath.startsWith("scene/Site/Plaza/") && changedPavementName.test(name);
};
const baselineMeshesByPath = new Map();
for (const mesh of baselineIndex.meshes) {
  if (isChangedFootPavementPath(mesh.path)) continue;
  const key = stablePath(mesh.path);
  assert.ok(!baselineMeshesByPath.has(key), `baseline mesh path ${key} is unique without child indexes`);
  baselineMeshesByPath.set(key, mesh);
}
const comparedBaselinePaths = new Set();
function compareLiveScene(node, parentWorld, path) {
  const semantic = Mat4.multiply(parentWorld, node.localMatrix());
  const nodePath = path + "/" + node.name;
  if (node.geometry) {
    const positions = node.geometry.positions;
    for (const value of positions) {
      assert.ok(Number.isFinite(value), `${nodePath} has only finite object-space positions`);
      assert.ok(value >= -1 && value <= 1, `${nodePath} object-space component ${value} remains in [-1, 1]`);
      ranges.min = Math.min(ranges.min, value);
      ranges.max = Math.max(ranges.max, value);
    }
    const meshWorld = node.worldGeometryMatrix(parentWorld);
    finalMeshes.push({ path: nodePath, vertexCount: positions.length / 3, floatOffset });
    if (isChangedFootPavementPath(nodePath)) {
      changedPavementMeshes.push({ path: nodePath, vertexCount: positions.length / 3 });
    } else {
      const key = stablePath(nodePath);
      const baseline = baselineMeshesByPath.get(key);
      assert.ok(baseline, `${nodePath} matches an unchanged mesh in the pre-normalization snapshot`);
      assert.ok(!comparedBaselinePaths.has(key), `${nodePath} uniquely matches its pre-normalization mesh`);
      assert.equal(positions.length / 3, baseline.vertexCount, `${nodePath} retains its pre-normalization vertex count`);
      comparedBaselinePaths.add(key);
      unchangedMeshes.push({ path: nodePath, vertexCount: positions.length / 3 });
      for (let index = 0; index < positions.length; index += 3) {
        const point = transformPoint(meshWorld, positions[index], positions[index + 1], positions[index + 2]);
        for (let axis = 0; axis < 3; axis += 1) {
          const expected = baselineVertexView.getFloat64((baseline.floatOffset + index + axis) * 8, true);
          const error = Math.abs(point[axis] - expected);
          maxWorldRestorationError = Math.max(maxWorldRestorationError, error);
        }
      }
    }
    floatOffset += positions.length;
  }
  for (let index = 0; index < node.children.length; index += 1) {
    compareLiveScene(node.children[index], semantic, nodePath + "[" + index + "]");
  }
}
compareLiveScene(scene, Mat4.identity(), "scene");
assert.equal(unchangedMeshes.length, baselineMeshesByPath.size, "all unaffected meshes match the independent pre-change snapshot");
assert.equal(comparedBaselinePaths.size, baselineMeshesByPath.size, "every unaffected baseline mesh is compared once");
assert.equal(changedPavementMeshes.length, 3, "only the circular apron and its clipped tile/grout surfaces changed");
assert.ok(maxWorldRestorationError < tolerance, `all unaffected world vertices match pre-change geometry within ${tolerance}, max error ${maxWorldRestorationError}`);

const collision = new CollisionWorld(scene, CONFIG.camera);
const probes = [
  ["camera-spawn", 0, 7.2],
  ["threshold-west", -1.5, 10.72], ["threshold-center", 0, 10.72], ["threshold-east", 1.5, 10.72],
  ["ramp-start", 0, 10.79], ["ramp-middle", 0, 11.39], ["ramp-end", 0, 11.99],
  ["road-entry", 0, 12.99], ["apron-center", 0, 0], ["bench-approach", 5.03, 13.81],
  ["monument-front", 0, 1.2], ["west-road", -8.79, -0.05], ["east-road", 8.79, -0.05],
].map(([label, x, z]) => ({
  label, x, z,
  surface: collision.findSurface(x, z, CONFIG.camera.collisionRadius),
  canOccupyGround: collision.canOccupy(x, z, 0, CONFIG.camera.standingBodyHeight),
}));
const actualSupport = {
  mapBounds: collision.mapBounds,
  colliderCount: collision.colliders.length,
  surfaceTriangleCount: collision.surfaces.length,
  colliders: collision.colliders.map((collider) => ({
    name: collider.name,
    shape: collider.shape,
    bounds: collider.bounds,
    ...(collider.innerRadius === undefined ? {} : {
      innerRadius: collider.innerRadius,
      outerRadius: collider.outerRadius,
      center: collider.center,
    }),
  })),
  safeSpawn: collision.findSafeSpawn(CONFIG.camera.startPosition[0], CONFIG.camera.startPosition[2], CONFIG.camera.collisionRadius, CONFIG.camera.standingBodyHeight),
  supportProbes: probes,
};
const withoutProbeSurfaceNames = (support) => ({
  ...support,
  supportProbes: support.supportProbes.map(({ surface, ...probe }) => ({
    ...probe,
    surface: surface ? { y: surface.y } : null,
  })),
});
const baselineUnchangedSupport = { ...baselineIndex.support };
const actualUnchangedSupport = { ...actualSupport };
delete baselineUnchangedSupport.surfaceTriangleCount;
delete actualUnchangedSupport.surfaceTriangleCount;
compareSnapshot(
  withoutProbeSurfaceNames(baselineUnchangedSupport),
  withoutProbeSurfaceNames(actualUnchangedSupport),
  "collision/support baseline excluding the intentionally changed apron tessellation",
);
const supportSurfaceTies = [];
for (let index = 0; index < baselineIndex.support.supportProbes.length; index += 1) {
  const before = baselineIndex.support.supportProbes[index];
  const after = actualSupport.supportProbes[index];
  if (before.surface?.name === after.surface?.name) continue;
  const equalHeightEntranceTie = before.label.startsWith("threshold")
    && before.surface?.name === "EntranceThresholdLip"
    && after.surface?.name === "OuterPavingFieldTiles";
  const equalHeightCircularApronTie = before.label === "monument-front"
    && before.surface?.name?.startsWith("ApronSide")
    && ["ApronTileSurfaces", "ApronGroutSurface"].includes(after.surface?.name);
  assert.ok(
    (equalHeightEntranceTie || equalHeightCircularApronTie)
      && Math.abs(before.surface.y - after.surface.y) <= 1e-5,
    `${before.label} keeps its support height except for documented equal-height pavement surface ties`,
  );
  supportSurfaceTies.push({ label: before.label, before: before.surface, after: after.surface });
}

console.log(JSON.stringify({
  normalizationCases: {
    sharedGeometryReuse: true,
    idempotent: true,
    geometryReplacement: true,
    newGeometryReplacementKeepsOldSharedInstances: true,
    emptyFlatAndPointMeshes: true,
    emptyCollisionMetadataAndNestedChildTraversal: true,
    nonFiniteAndMalformedPositionsRejected: true,
    nestedChildTransformsPreserved: true,
    syntheticMaxRestorationError: syntheticRestoreError,
  },
  scene: {
    meshes: finalMeshes.length,
    vertices: floatOffset / 3,
    baselineComparedMeshes: unchangedMeshes.length,
    intentionalPavementChangeMeshes: changedPavementMeshes,
    objectSpaceRange: [ranges.min, ranges.max],
    maxWorldVertexError: maxWorldRestorationError,
  },
  support: {
    colliders: collision.colliders.length,
    surfaceTriangles: collision.surfaces.length,
    safeSpawn: actualSupport.safeSpawn,
    probes: probes.length,
    equalHeightSurfaceTies: supportSurfaceTies,
  },
  result: "passed",
}, null, 2));
