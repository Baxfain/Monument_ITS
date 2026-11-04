#!/usr/bin/env node
import assert from "node:assert/strict";
import { CONFIG, deriveMonumentLayout } from "../src/config.js";
import { Mat4 } from "../src/math3d.js";
import {
  createApronGridGeometry,
  createExtrudedPolygonFieldGeometry,
  createPolygonFieldGeometry,
} from "../src/geometry.js";
import { createMonument, createScene } from "../src/scene.js";

const tolerance = 1e-6;
const near = (actual, expected, label, allowedError = tolerance) => {
  assert.ok(Math.abs(actual - expected) <= allowedError, `${label}: expected ${expected}, got ${actual}`);
};

function findNode(root, name) {
  if (root.name === name) return root;
  for (const child of root.children) {
    const match = findNode(child, name);
    if (match) return match;
  }
  return null;
}

function worldY(root, node) {
  let y = 0;
  let current = node;
  while (current && current !== root) {
    y += current.position[1];
    current = current.parent;
  }
  return y;
}

function addParents(node) {
  for (const child of node.children) {
    child.parent = node;
    addParents(child);
  }
  return node;
}

function uvRangeForFrontFace(geometry) {
  const v = Array.from({ length: 6 }, (_, index) => geometry.uvs[index * 2 + 1]);
  return Math.max(...v) - Math.min(...v);
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function constructionPositions(node) {
  const output = new Float32Array(node.geometry.positions.length);
  const matrix = node.objectToConstruction;
  for (let index = 0; index < output.length; index += 3) {
    const point = transformPoint(matrix, ...node.geometry.positions.slice(index, index + 3));
    output.set(point, index);
  }
  return output;
}

function localBounds(node) {
  const matrix = Mat4.multiply(node.localMatrix(), node.objectToConstruction);
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let index = 0; index < node.geometry.positions.length; index += 3) {
    const x = node.geometry.positions[index];
    const y = node.geometry.positions[index + 1];
    const z = node.geometry.positions[index + 2];
    const point = [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ];
    bounds.minX = Math.min(bounds.minX, point[0]);
    bounds.minY = Math.min(bounds.minY, point[1]);
    bounds.minZ = Math.min(bounds.minZ, point[2]);
    bounds.maxX = Math.max(bounds.maxX, point[0]);
    bounds.maxY = Math.max(bounds.maxY, point[1]);
    bounds.maxZ = Math.max(bounds.maxZ, point[2]);
  }
  return bounds;
}

function geometryCoversXZ(geometry, x, z, objectToConstruction = Mat4.identity()) {
  const positions = geometry.positions;
  for (let index = 0; index + 8 < positions.length; index += 9) {
    const a3 = transformPoint(objectToConstruction, positions[index], positions[index + 1], positions[index + 2]);
    const b3 = transformPoint(objectToConstruction, positions[index + 3], positions[index + 4], positions[index + 5]);
    const c3 = transformPoint(objectToConstruction, positions[index + 6], positions[index + 7], positions[index + 8]);
    const a = [a3[0], a3[2]];
    const b = [b3[0], b3[2]];
    const c = [c3[0], c3[2]];
    const minX = Math.min(a[0], b[0], c[0]);
    const maxX = Math.max(a[0], b[0], c[0]);
    const minZ = Math.min(a[1], b[1], c[1]);
    const maxZ = Math.max(a[1], b[1], c[1]);
    if (x < minX - tolerance || x > maxX + tolerance || z < minZ - tolerance || z > maxZ + tolerance) continue;
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const first = cross(a, b, [x, z]);
    const second = cross(b, c, [x, z]);
    const third = cross(c, a, [x, z]);
    if ((first >= -tolerance && second >= -tolerance && third >= -tolerance)
      || (first <= tolerance && second <= tolerance && third <= tolerance)) return true;
  }
  return false;
}

function triangleAreaXZ(geometry) {
  let area = 0;
  for (let index = 0; index < geometry.positions.length; index += 9) {
    const ax = geometry.positions[index];
    const az = geometry.positions[index + 2];
    const bx = geometry.positions[index + 3];
    const bz = geometry.positions[index + 5];
    const cx = geometry.positions[index + 6];
    const cz = geometry.positions[index + 8];
    area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
  }
  return area;
}

const gridProbeWidth = 2.42;
const gridProbeDepth = 14.86;
const gridColumns = 5;
const gridRows = 44;
const gridJointWidth = 0.018;
const grid = createApronGridGeometry(
  [gridProbeWidth, 1, gridProbeDepth],
  gridColumns - 1,
  gridJointWidth,
  gridRows - 1,
);
const expectedGridTileArea = (gridProbeWidth - (gridColumns - 1) * gridJointWidth)
  * (gridProbeDepth - (gridRows - 1) * gridJointWidth);
const measuredGridTileArea = triangleAreaXZ(grid.tiles) * gridProbeWidth * gridProbeDepth;
const expectedGridGroutArea = gridProbeWidth * gridProbeDepth - expectedGridTileArea;
const measuredGridGroutArea = triangleAreaXZ(grid.grout) * gridProbeWidth * gridProbeDepth;
near(measuredGridTileArea, expectedGridTileArea, "grid tile area accounts for every row and column joint", 1e-5);
near(
  measuredGridGroutArea,
  expectedGridGroutArea,
  "grid grout covers the full complement of tile area",
  1e-5,
);
near(measuredGridTileArea + measuredGridGroutArea, gridProbeWidth * gridProbeDepth, "grid tiles and grout cover the full rectangular footprint", 1e-5);
const lastGridJointZ = -0.5 + (gridRows - 1) / gridRows;
const finalGridTileCenterZ = -0.5 + (gridRows - 0.5) / gridRows;
assert.ok(geometryCoversXZ(grid.grout, 0.05, lastGridJointZ), "the final second-axis grid grout strip is present");
assert.ok(geometryCoversXZ(grid.tiles, 0.05, finalGridTileCenterZ), "the final grid tile row reaches the segment edge");
assert.ok(!geometryCoversXZ(grid.grout, 0.05, finalGridTileCenterZ), "the final grid tile row remains tile rather than grout");

const polygonProbeOuter = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
const polygonFieldProbes = [
  {
    name: "disjoint holes",
    holes: [
      [[-3, -1], [-1, -1], [-1, 1], [-3, 1]],
      [[1, -1], [3, -1], [3, 1], [1, 1]],
    ],
    expectedArea: 92,
  },
  {
    name: "nested holes",
    holes: [
      [[-3, -2], [3, -2], [3, 2], [-3, 2]],
      [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    ],
    expectedArea: 76,
  },
  {
    name: "intersecting holes",
    holes: [
      [[-3, -2], [1, -2], [1, 1], [-3, 1]],
      [[-1, -1], [3, -1], [3, 2], [-1, 2]],
    ],
    expectedArea: 80,
  },
];
const polygonProbeResults = [];
for (const probe of polygonFieldProbes) {
  const field = createPolygonFieldGeometry(polygonProbeOuter, probe.holes);
  const actualArea = triangleAreaXZ(field);
  near(actualArea, probe.expectedArea, `${probe.name} preserve the independent exposed-field area`);
  const solid = createExtrudedPolygonFieldGeometry(polygonProbeOuter, probe.holes, 0.08);
  const verticalWallVertices = solid.normals.filter((_, index) => index % 3 === 1 && Math.abs(solid.normals[index]) < tolerance).length;
  assert.equal(verticalWallVertices, polygonProbeOuter.length * 6, `${probe.name} do not add duplicate or stray cutout walls`);
  polygonProbeResults.push({ name: probe.name, expectedArea: probe.expectedArea, actualArea, verticalWallVertices });
}

const baselineConfig = structuredClone(CONFIG);
const editedConfig = structuredClone(CONFIG);
editedConfig.monument.mainBody.size[1] += 0.3;

const baselineLayout = deriveMonumentLayout(baselineConfig.monument, baselineConfig.camera.collisionBoundsMargin);
const editedLayout = deriveMonumentLayout(editedConfig.monument, editedConfig.camera.collisionBoundsMargin);
const baselineScene = addParents(createMonument(baselineConfig));
const editedScene = addParents(createMonument(editedConfig));

const scene = addParents(createScene());
const plaza = findNode(scene, "Plaza");
assert.equal(findNode(scene, "AsymmetricGlazedCampusBuilding"), null, "rear campus building is omitted from the rendered scene");
assert.equal(findNode(scene, "BuildingAccessRoad"), null, "the removed rear building has no stale access road mesh");
assert.ok(findNode(scene, "ParkTree01"), "campus trees remain in the scene");
assert.ok(findNode(scene, "WhiteParkBench01"), "campus benches remain in the scene");
assert.ok(findNode(scene, "Monument"), "monument remains in the scene");
assert.ok(findNode(scene, "GroundPlane"), "map boundary remains in the scene");
const squareApron = findNode(plaza, "SquarePavingApron");
assert.ok(squareApron?.geometry, "the monument foot has a square tiled apron");
assert.equal(findNode(plaza, "CircularPavingApron"), null, "the circular monument-foot apron is absent");
assert.deepEqual(squareApron.scale, baselineConfig.plaza.tilePadSize, "the apron keeps its original square footprint");
assert.deepEqual(squareApron.collision, { surface: true }, "the square apron remains walkable");
assert.deepEqual(squareApron.material, baselineConfig.materials.tile, "the square apron keeps the tile material");
const squareApronBounds = localBounds(squareApron);
near(squareApronBounds.minX, -baselineConfig.plaza.tilePadSize[0] / 2, "the square apron reaches its west edge");
near(squareApronBounds.maxX, baselineConfig.plaza.tilePadSize[0] / 2, "the square apron reaches its east edge");
near(squareApronBounds.minZ, -baselineConfig.plaza.tilePadSize[2] / 2, "the square apron reaches its south edge");
near(squareApronBounds.maxZ, baselineConfig.plaza.tilePadSize[2] / 2, "the square apron reaches its north edge");

const apronGrout = plaza.children.filter((node) => node.name.startsWith("ApronGrout"));
assert.equal(apronGrout.length, baselineConfig.plaza.tileGroutCount * 2, "square tiles retain crossing grout lines");
for (const joint of apronGrout) {
  assert.deepEqual(joint.collision, { surface: true }, `${joint.name} remains walkable`);
  assert.deepEqual(joint.material, baselineConfig.materials.grout, `${joint.name} keeps the grout material`);
}

const apronSideTriangles = plaza.children.filter((node) => node.name.startsWith("ApronSide"));
assert.equal(apronSideTriangles.length, 4, "four dark triangles line the sides of the square apron");
for (const triangle of apronSideTriangles) {
  assert.ok(triangle.geometry, `${triangle.name} has triangular geometry`);
  assert.equal(triangle.geometry.vertexCount, 24, `${triangle.name} keeps its solid triangular prism`);
  assert.deepEqual(triangle.collision, { surface: true }, `${triangle.name} remains walkable`);
  assert.deepEqual(triangle.material, baselineConfig.materials.tileAccent, `${triangle.name} keeps the dark accent`);
}
const apronCornerTiles = plaza.children.filter((node) => node.name.startsWith("ApronCorner"));
assert.equal(apronCornerTiles.length, 4, "four corner tiles complete the square apron pattern");
for (const triangle of apronCornerTiles) {
  assert.equal(triangle.geometry.vertexCount, 3, `${triangle.name} keeps its flat triangular tile`);
  assert.deepEqual(triangle.material, baselineConfig.materials.tile, `${triangle.name} uses the apron tile material`);
}

const planting = findNode(scene, "PlantingGroups");
assert.ok(planting, "separate landscape planting groups remain in the scene");
assert.equal(findNode(scene, "NearFrontPlantingBed"), null, "the former continuous planting bed is removed");
const pocketSettings = baselineConfig.plants.plantingPockets;
const soilPocketNodes = planting.children.filter((node) => pocketSettings.some((pocket) => pocket.name === node.name));
assert.equal(soilPocketNodes.length, pocketSettings.length, "each configured planting pocket has its own landscape group");
const frontArcBeds = pocketSettings.filter((pocket) => pocket.name.startsWith("FrontArcSoilBed"));
const rearArcBeds = pocketSettings.filter((pocket) => pocket.name.startsWith("RearArcSoilBed"));
assert.equal(frontArcBeds.length, 1, "the front row uses one connected curved soil bed");
assert.equal(rearArcBeds.length, 1, "the rear row uses one connected curved soil bed");
const frontClusters = frontArcBeds.flatMap((bed) => bed.clusters);
const rearClusters = rearArcBeds.flatMap((bed) => bed.clusters);
assert.equal(frontClusters.length, 12, "front rosettes fill three radial rows across the entire soil bed");
assert.equal(rearClusters.length, 12, "rear plants fill three radial rows across the entire soil bed");
const polygonArea = (contour) => Math.abs(contour.reduce((sum, [x, z], index) => {
  const [nextX, nextZ] = contour[(index + 1) % contour.length];
  return sum + x * nextZ - nextX * z;
}, 0)) / 2;
assert.ok(polygonArea(frontArcBeds[0].contour) > 1, "the four front plants share a single connected soil area");
assert.ok(frontClusters.every((cluster) =>
  cluster.species === "dark-spread"
    && cluster.leaves === 28
    && cluster.height[0] >= 0.25
    && cluster.height[1] <= 0.37
    && cluster.bend[1] >= 0.19
    && cluster.width[0] >= 0.045
    && cluster.stem === null),
"front plants use short, dark-green, laterally spreading leaves without stems");
assert.ok(rearClusters.every((cluster) =>
  cluster.height[0] >= 0.5 && cluster.leaves === 13 && cluster.species === "rust"),
"rear plants are taller and retain their distinct russet species");
const curbInnerRadius = baselineConfig.plaza.outerPavingRadius;
const frontBed = frontArcBeds[0];
const rearBed = rearArcBeds[0];
for (const bed of [frontBed, rearBed]) {
  const forwardSign = bed === frontBed ? 1 : -1;
  for (const [x, z] of bed.contour) {
    const radius = Math.hypot(x, z);
    assert.ok(radius >= bed.innerRadius - tolerance && radius <= bed.outerRadius + tolerance, `${bed.name} soil follows the circular band`);
    assert.ok(radius <= curbInnerRadius - 0.02 + tolerance, `${bed.name} soil reaches the outer circle just before the dark curb`);
    assert.ok(z * forwardSign > 0, `${bed.name} soil stays on its side of the monument`);
  }
}
const sidePlantBlocks = pocketSettings.filter((pocket) => pocket.name.startsWith("SidePlantBlock"));
const plantingBlocks = [frontBed, ...sidePlantBlocks, rearBed];
assert.equal(sidePlantBlocks.length, 6, "three curved soil blocks remain on each monument side");
assert.equal(sidePlantBlocks.filter((block) => block.contour.reduce((sum, [x]) => sum + x, 0) > 0).length, 3, "three separated plant blocks sit on the east side");
assert.equal(sidePlantBlocks.filter((block) => block.contour.reduce((sum, [x]) => sum + x, 0) < 0).length, 3, "three separated plant blocks sit on the west side");
const variegatedShrubBlocks = sidePlantBlocks.filter((block) =>
  [Math.PI * 7 / 4, Math.PI * 3 / 4].some((angle) => Math.abs(block.centerAngle - angle) < tolerance));
assert.equal(variegatedShrubBlocks.length, 2, "plant blocks numbered two and six use the shrub planting style");
for (const block of variegatedShrubBlocks) {
  assert.equal(block.clusters.length, 12, `${block.name} shrubs spread across the full bed`);
  assert.ok(block.clusters.every((shrub) =>
    shrub.species === "variegated-shrub"
      && shrub.leaves === 100
      && shrub.height[0] >= 0.3
      && shrub.rootSpread >= 0.18
      && shrub.width[0] <= 0.025
      && shrub.stem?.height[0] >= 0.1
      && shrub.leafBaseHeight > 0),
  `${block.name} has hidden thin stems and dense, small leaves that cover the soil`);
  for (const [clusterIndex] of block.clusters.entries()) {
    const clusterNode = findNode(findNode(planting, block.name), `LeafCluster${String(clusterIndex + 1).padStart(2, "0")}`);
    const foliage = clusterNode.children;
    const stem = findNode(clusterNode, "PlantStem");
    assert.ok(stem, `${block.name} cluster ${clusterIndex + 1} has a subtle stem`);
    assert.deepEqual(stem.material, baselineConfig.materials.plantStem, `${block.name} cluster ${clusterIndex + 1} uses stem material`);
    assert.ok(foliage.some((node) =>
      JSON.stringify(node.material) === JSON.stringify(baselineConfig.materials.leafCream)),
    `${block.name} foliage includes the pale variegation from the reference`);
  }
}
for (const block of sidePlantBlocks) {
  assert.ok(block.contour.length > 4, `${block.name} soil follows an arc-shaped block footprint`);
  assert.equal(block.clusters.length, 12, `${block.name} plants span the complete soil block`);
  assert.ok(block.clusters.every((cluster) =>
    cluster.species === "variegated-shrub" || cluster.height[0] >= 0.37),
  `${block.name} default plants grow taller while variegated shrubs stay compact`);
  assert.equal(block.shape, "annular-sector", `${block.name} soil follows the circle instead of becoming a trapezoid`);
}
const rearStemBed = findNode(planting, rearBed.name);
for (let index = 0; index < rearBed.clusters.length; index += 1) {
  const cluster = rearBed.clusters[index];
  const clusterNode = findNode(rearStemBed, `LeafCluster${String(index + 1).padStart(2, "0")}`);
  const stem = findNode(clusterNode, "PlantStem");
  assert.ok(stem, `rear plant ${index + 1} has its own thin wooden stem`);
  near(stem.scale[0], cluster.stem.radius * 2, `rear plant ${index + 1} stem thickness`);
  assert.ok(clusterNode.children.some((node) =>
    [baselineConfig.materials.leafRust, baselineConfig.materials.leafRustLight].some((material) =>
      JSON.stringify(node.material) === JSON.stringify(material))),
  `rear plant ${index + 1} retains its reddish pointed foliage`);
}
for (const block of plantingBlocks) {
  const radialRows = new Set(block.clusters.map((cluster) =>
    Math.round((Math.hypot(...cluster.position) - block.innerRadius) / (block.outerRadius - block.innerRadius) * 100)));
  const angularColumns = new Set(block.clusters.map((cluster) =>
    Math.round(Math.atan2(
      Math.sin(Math.atan2(cluster.position[0], cluster.position[1]) - block.centerAngle),
      Math.cos(Math.atan2(cluster.position[0], cluster.position[1]) - block.centerAngle),
    ) / block.halfAngle * 100)));
  assert.equal(radialRows.size, 3, `${block.name} has plant roots across the soil depth`);
  assert.equal(angularColumns.size, 4, `${block.name} has plant roots across the soil width`);
}
assert.equal(plantingBlocks.length, 8, "one front, one rear, and six side beds form eight planting blocks");
assert.equal(new Set(plantingBlocks.map((block) => Math.round(block.centerAngle * 1e6))).size, 8, "planting blocks have distinct evenly spaced centers");
const sortedPlantingAngles = plantingBlocks
  .map((block) => (block.centerAngle + Math.PI * 2) % (Math.PI * 2))
  .sort((a, b) => a - b);
for (let index = 0; index < sortedPlantingAngles.length; index += 1) {
  const next = sortedPlantingAngles[(index + 1) % sortedPlantingAngles.length]
    + (index === sortedPlantingAngles.length - 1 ? Math.PI * 2 : 0);
  near(next - sortedPlantingAngles[index], Math.PI / 4, "planting blocks are evenly spaced around the plaza");
}
for (const block of plantingBlocks) {
  near(block.outerRadius, plantingBlocks[0].outerRadius, `${block.name} reaches the shared outer planting radius`);
  near(block.halfAngle, Math.PI / 16, `${block.name} matches the shared planting-block width`);
  near(block.outerRadius - block.innerRadius, 0.96, `${block.name} uses the shared 60% planting depth`);
  assert.ok(block.clusters.every((cluster) => {
    const radius = Math.hypot(...cluster.position);
    return radius >= block.innerRadius && radius <= block.outerRadius;
  }), `${block.name} plant roots span the soil depth`);
}
assert.ok(rearClusters.every((cluster) =>
  cluster.height[0] >= 0.5 && cluster.height[1] <= 0.6),
"rear plants are taller than in the previous layout");
const floorFrames = baselineConfig.plaza.plantingFloorFrames;
assert.equal(floorFrames.length, 8, "one trapezoid brick frame sits between each neighboring pair of planting blocks");
for (const frame of floorFrames) {
  const frameNode = findNode(plaza, frame.name);
  assert.ok(frameNode?.geometry, `${frame.name} is visible in the paving`);
  assert.deepEqual(frameNode.material, baselineConfig.materials.tileAccent, `${frame.name} uses the dark brick accent`);
  assert.ok(frameNode.geometry.vertexCount > 0, `${frame.name} has real raised-frame geometry`);
  const innerCenter = frame.innerContour.reduce((sum, [x, z]) => [
    sum[0] + x / frame.innerContour.length,
    sum[1] + z / frame.innerContour.length,
  ], [0, 0]);
  assert.ok(!geometryCoversXZ(frameNode.geometry, ...innerCenter, frameNode.objectToConstruction), `${frame.name} leaves its center open as a paving motif`);
  const frameBandPoint = [
    frame.contour[0][0] * 0.1 + frame.innerContour[0][0] * 0.9,
    frame.contour[0][1] * 0.1 + frame.innerContour[0][1] * 0.9,
  ];
  assert.ok(geometryCoversXZ(frameNode.geometry, ...frameBandPoint, frameNode.objectToConstruction), `${frame.name} has a continuous brick border`);
  assert.ok(frame.contour.some(([x, z]) => Math.hypot(x, z) > 5.5), `${frame.name} follows the outer plaza radius`);
  assert.ok(frame.contour.length > 4, `${frame.name} has a curved edge rather than a straight trapezoid edge`);
  for (const [x, z] of frame.contour.slice(0, 13)) {
    near(Math.hypot(x, z), frame.outerRadius, `${frame.name} outer edge follows the circular plaza`, 1e-5);
  }
  const frameAngle = (frame.centerAngle + Math.PI * 2) % (Math.PI * 2);
  const angleIndex = sortedPlantingAngles.findIndex((angle) => angle > frameAngle);
  const previous = angleIndex > 0
    ? sortedPlantingAngles[angleIndex - 1]
    : angleIndex === 0 ? sortedPlantingAngles.at(-1) - Math.PI * 2 : sortedPlantingAngles.at(-1);
  const next = angleIndex >= 0 ? sortedPlantingAngles[angleIndex] : sortedPlantingAngles[0] + Math.PI * 2;
  near(frameAngle, (previous + next) / 2, `${frame.name} sits halfway between neighboring planting blocks`);
  near(frame.innerRadius, 4.28, `${frame.name} retains its full inward reach`);
  near(frame.outerRadius, plantingBlocks[0].outerRadius, `${frame.name} reaches the soil blocks at the plaza edge`);
  near(frame.halfAngle, Math.PI / 16, `${frame.name} touches its neighboring planting blocks`);
  near(frame.outerRadius - frame.innerRadius, 1.6, `${frame.name} is longer than the previous trapezoid layout`);
  near(frame.halfAngle * 2, Math.PI / 8, `${frame.name} is wider than the previous trapezoid layout`);
}
const sectorPoint = (radius, angle) => [Math.sin(angle) * radius, Math.cos(angle) * radius];
const normalizeAngle = (angle) => (angle + Math.PI * 2) % (Math.PI * 2);
for (const block of plantingBlocks) {
  const nextFrame = floorFrames.find((frame) =>
    Math.abs(normalizeAngle(frame.centerAngle) - normalizeAngle(block.centerAngle + Math.PI / 8)) < tolerance);
  assert.ok(nextFrame, `${block.name} has an adjacent trapezoid frame`);
  const seamAngle = block.centerAngle + Math.PI / 16;
  for (const [actual, expected, label] of [
    [nextFrame.contour[0], sectorPoint(block.outerRadius, seamAngle), "outer seam"],
    [block.contour[24], sectorPoint(block.outerRadius, seamAngle), "soil outer seam"],
    [block.contour[25], sectorPoint(block.innerRadius, seamAngle), "soil inner seam"],
  ]) {
    near(actual[0], expected[0], `${block.name} ${label} X connects without a gap`, 1e-5);
    near(actual[1], expected[1], `${block.name} ${label} Z connects without a gap`, 1e-5);
  }
  assert.equal(findNode(plaza, "RearRightPatchyLawn"), null, "the overlapping outer-circle lawn patch is removed");
}
const annularPavingNodes = plaza.children.filter((node) =>
  node.name.startsWith("PaverAnnulusTiles")
  || node.name.startsWith("PaverArcJoint")
  || node.name.startsWith("PaverRadialJoint"));
const outerPavingTiles = findNode(plaza, "OuterPavingFieldTiles");
const outerPavingGrout = findNode(plaza, "OuterPavingFieldGrout");
assert.ok(outerPavingTiles?.geometry && outerPavingGrout?.geometry, "the shaped paving field has separate tile and grout surfaces");
assert.equal(baselineConfig.plaza.outerPavingOutline.length, 128, "the outer paving outline is a closed circular contour");
for (const [x, z] of baselineConfig.plaza.outerPavingOutline) {
  near(Math.hypot(x, z), baselineConfig.plaza.outerPavingRadius, "the outer paving outline stays on its circular radius");
}
assert.ok(!geometryCoversXZ(outerPavingTiles.geometry, 0, 9.1, outerPavingTiles.objectToConstruction), "outer paving ends at the circular plaza edge");
const outerTilePositions = constructionPositions(outerPavingTiles);
for (let index = 0; index < outerTilePositions.length; index += 3) {
  assert.ok(
    Math.hypot(outerTilePositions[index], outerTilePositions[index + 2]) <= baselineConfig.plaza.outerPavingRadius + tolerance,
    "outer paving has no tile vertices outside the circular plaza",
  );
}
const outerFieldBounds = localBounds(outerPavingTiles);
near(outerFieldBounds.minX, Math.min(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)), "outer paving field stays inside its west edge");
near(outerFieldBounds.maxX, Math.max(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)), "outer paving field stays inside its east edge");
near(outerFieldBounds.minZ, Math.min(...baselineConfig.plaza.outerPavingOutline.map(([, z]) => z)), "outer paving field stays inside its rear edge");
near(outerFieldBounds.maxZ, baselineConfig.plaza.outerPavingRadius, "outer paving field stays inside its circular north edge");
const annulusPaverTiles = annularPavingNodes.filter((node) => node.name.startsWith("PaverAnnulusTiles"));
assert.equal(annulusPaverTiles.length, baselineConfig.plaza.paverRows, "each configured radial row has its own clipped tile mesh");
for (const pavingNode of [...annularPavingNodes, outerPavingTiles]) {
  const positions = constructionPositions(pavingNode);
  const localY = Array.from(
    { length: pavingNode.geometry.vertexCount },
    (_, index) => positions[index * 3 + 1],
  );
  near(worldY(scene, pavingNode) + Math.max(...localY), baselineConfig.plaza.paverTopY, `${pavingNode.name} top follows the paving level`);
  near(worldY(scene, pavingNode) + Math.min(...localY), baselineConfig.plaza.groundTopY, `${pavingNode.name} slab reaches the ground`);
  if (pavingNode !== outerPavingTiles) {
    for (let index = 0; index < pavingNode.geometry.positions.length; index += 3) {
      const x = positions[index];
      const z = positions[index + 2];
      assert.ok(Math.hypot(x, z) <= baselineConfig.plaza.paverOuterRadius + tolerance, `${pavingNode.name} remains inside the annular paving boundary`);
    }
  }
}
near(worldY(scene, outerPavingGrout), baselineConfig.plaza.paverTopY, "outer paving joints sit flush with the tile top");

let soilRootCount = 0;
for (const pocket of pocketSettings) {
  for (const [x, z] of pocket.contour) {
    assert.ok(Math.hypot(x, z) <= baselineConfig.plaza.outerPavingRadius, `${pocket.name} soil stays inside the circular plaza`);
    assert.ok(Math.hypot(x, z) <= curbInnerRadius - 0.02 + tolerance, `${pocket.name} soil reaches the outer circle just before the dark curb`);
  }
  assert.equal(pocket.shape, "annular-sector", `${pocket.name} soil follows the shared curved planting layout`);
  const bed = findNode(planting, pocket.name);
  const soilBed = findNode(bed, `${pocket.name}SoilSurface`);
  assert.ok(soilBed?.geometry, `${pocket.name} has its own soil surface mesh`);
  assert.deepEqual(soilBed.material, baselineConfig.materials.soil, `${pocket.name} uses the soil material`);
  assert.ok(soilBed.geometry.vertexCount > 0, `${pocket.name} soil surface contains real geometry`);
  const soilPositions = constructionPositions(soilBed);
  let soilTopArea = 0;
  for (let index = 0; index < soilBed.geometry.vertexCount; index += 3) {
    const vertexOffset = index * 3;
    if (soilBed.geometry.normals[vertexOffset + 1] <= 0.9) continue;
    const a = soilPositions.subarray(vertexOffset, vertexOffset + 3);
    const b = soilPositions.subarray(vertexOffset + 3, vertexOffset + 6);
    const c = soilPositions.subarray(vertexOffset + 6, vertexOffset + 9);
    soilTopArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2;
  }
  near(soilTopArea, polygonArea(pocket.contour), `${pocket.name} soil completely covers its floor without gaps`);
  const localY = Array.from(
    { length: soilBed.geometry.vertexCount },
    (_, index) => soilPositions[index * 3 + 1],
  );
  near(worldY(scene, soilBed) + Math.max(...localY), baselineConfig.plants.soilSurfaceY, `${pocket.name} soil top supports its roots`);
  near(worldY(scene, soilBed) + Math.min(...localY), baselineConfig.plaza.groundTopY, `${pocket.name} soil base meets the ground`);
  assert.ok(
    baselineConfig.plants.soilSurfaceY >= baselineConfig.plaza.paverTopY + 0.025,
    `${pocket.name} soil cap sits above paving to hide joints beneath the bed`,
  );

  for (const [clusterIndex, cluster] of pocket.clusters.entries()) {
    const [x, z] = cluster.position;
    const group = findNode(bed, `LeafCluster${String(clusterIndex + 1).padStart(2, "0")}`);
    assert.ok(group, `${pocket.name} cluster is nested in its own pocket`);
    near(group.position[1], baselineConfig.plants.soilSurfaceY, `${pocket.name} cluster root elevation`);
    near(group.rotation[1], cluster.rotationY, `${pocket.name} plant orientation follows the circular arc`);
    assert.ok(geometryCoversXZ(soilBed.geometry, x, z, soilBed.objectToConstruction), `${pocket.name} soil covers its plant root`);
    assert.ok(!geometryCoversXZ(outerPavingTiles.geometry, x, z, outerPavingTiles.objectToConstruction), `${pocket.name} root is an opening in outer paving`);
    assert.ok(!geometryCoversXZ(outerPavingGrout.geometry, x, z, outerPavingGrout.objectToConstruction), `${pocket.name} root is clear of outer paving joints`);
    assert.ok(!annularPavingNodes.some((node) => geometryCoversXZ(node.geometry, x, z, node.objectToConstruction)), `${pocket.name} root is clear of annular tiles and joints`);
    assert.ok(
      cluster.rootSpread < pocket.halfAngle * pocket.innerRadius,
      `${pocket.name} root spread fits inside its curved soil patch`,
    );
    assert.ok(
      Math.hypot(x, z) + cluster.rootSpread + cluster.bend[1] + cluster.width[1] / 2 + baselineConfig.wind.amplitude <= curbInnerRadius,
      `${pocket.name} leaves and wind stay before the dark outer curb`,
    );
    soilRootCount += 1;
  }
}
assert.equal(soilRootCount, 96, "all eight beds support their full 12-cluster planting layouts");
const rearFirstCluster = findNode(findNode(planting, rearArcBeds[0].name), "LeafCluster01");
assert.ok(rearFirstCluster.children.length > 0, "the rear bed has visible foliage");
assert.ok(
  rearFirstCluster.children.filter((leafSet) => leafSet.name.startsWith("WindLeafSet")).every((leafSet) =>
    [baselineConfig.materials.leafRust, baselineConfig.materials.leafRustLight].some((material) =>
      JSON.stringify(leafSet.material) === JSON.stringify(material))),
  "rear foliage uses russet materials rather than the front bed's gold-green palette",
);

assert.ok(geometryCoversXZ(outerPavingTiles.geometry, 2.6, -2.8, outerPavingTiles.objectToConstruction)
  || annularPavingNodes.some((node) => geometryCoversXZ(node.geometry, 2.6, -2.8, node.objectToConstruction)),
"paving covers the former overlapping lawn area without a hole");
assert.equal(planting.children.some((node) => node.name.startsWith("RussetTuft")), false, "detached russet tufts do not interrupt the connected planting layout");
assert.equal(planting.children.some((node) => node.name.startsWith("VariegatedLowShrub")), false, "outer-circle green bushes are removed");

const curbSegments = plaza.children.filter((node) => node.name.startsWith("OuterCircularCurb"));
assert.ok(curbSegments.length > 80, "the circular outer curb follows the plaza edge while leaving the planting beds open");
for (const segment of curbSegments) {
  assert.deepEqual(segment.material, baselineConfig.materials.outerCurb, `${segment.name} uses the dark outer curb material`);
  assert.deepEqual(segment.collision, { solid: true, surface: true }, `${segment.name} provides solid low-step support`);
}
assert.equal(plaza.children.some((node) => node.name.startsWith("Roadway")), false, "no tiled roadway remains outside the plaza");
assert.equal(findNode(plaza, "EntranceThresholdLip"), null, "the entrance lip is removed");
assert.equal(findNode(plaza, "EntranceAccessRamp"), null, "the entrance ramp is removed");
const innerCurb = findNode(plaza, "RaisedCircularCurb");
assert.ok(innerCurb, "the pale central gravel curb remains a distinct circular feature");
assert.notDeepEqual(innerCurb.material, baselineConfig.materials.outerCurb, "the inner gravel curb and outer circular curb use distinct materials");
const outerCurbTopY = baselineConfig.plaza.outerCircularCurb.baseY + baselineConfig.plaza.outerCircularCurb.height;
near(outerCurbTopY, baselineConfig.plaza.paverTopY, "outer curb top is flush with the plaza paving");
near(baselineConfig.plaza.outerCircularCurb.baseY, baselineConfig.plaza.groundTopY, "outer curb starts at the surrounding ground");
assert.ok(
  baselineConfig.plaza.outerCircularCurb.height <= baselineConfig.camera.maxStepHeight,
  "the segmented outer curb remains within the configured walking step height",
);

let whiteSupportVertexCount = 0;
let flowerPetalVertexCount = 0;
for (const faceName of ["EmblemFaceFront", "EmblemFaceRear"]) {
  const face = findNode(baselineScene, faceName);
  assert.ok(face, `${faceName} exists`);
  const panels = face.children.filter((child) => child.name.startsWith("TorchBase") && child.name !== "TorchBaseDivider");
  assert.deepEqual(
    panels.map((panel) => panel.name).sort(),
    ["TorchBaseInnerLeft", "TorchBaseInnerRight", "TorchBaseOuterLeft", "TorchBaseOuterRight"],
    `${faceName} has four mirrored angular calyx panels`,
  );
  for (const panel of panels) {
    const outline = panel.children.find((child) => child.name === "DarkContour");
    const fill = panel.children.find((child) => child.name === "SilverFold");
    assert.ok(outline?.geometry && fill?.geometry, `${panel.name} has a dark outline and silver fill`);
    assert.ok(fill.geometry.vertexCount >= 30, `${panel.name} has a closed extruded contour`);
    assert.equal(fill.geometry.positions.length, fill.geometry.normals.length, `${panel.name} position and normal buffers match`);
    assert.equal(fill.geometry.uvs.length * 3, fill.geometry.positions.length * 2, `${panel.name} position and UV buffers match`);
    assert.ok([...fill.geometry.positions].every(Number.isFinite), `${panel.name} vertices are finite`);
    const fillPositions = constructionPositions(fill);
    const localX = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fillPositions[index * 3]);
    const localY = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fillPositions[index * 3 + 1]);
    if (panel.name.endsWith("Right")) {
      assert.ok(Math.min(...localX) >= -0.001 && Math.max(...localX) > 0.04, `${panel.name} traces the right half of the white calyx`);
    } else {
      assert.ok(Math.min(...localX) < -0.04 && Math.max(...localX) <= 0.001, `${panel.name} traces the left half of the white calyx`);
    }
    near(Math.max(...localY), 0, `${panel.name} meets the common flower junction`);
    assert.ok(Math.min(...localY) < -0.13, `${panel.name} reaches the low angular foot`);
    near(panel.position[1], CONFIG.monument.emblem.flowerBaseY, `${panel.name} stays anchored to the flower junction`);
    whiteSupportVertexCount += fill.geometry.vertexCount;
  }
  const divider = face.children.find((child) => child.name === "TorchBaseDivider");
  near(divider.position[2], CONFIG.monument.emblem.torchBaseDividerZ, `${faceName} center seam follows its configured depth`);
  near(divider.position[1] - divider.scale[1] / 2, CONFIG.monument.emblem.torchBaseBottomY, `${faceName} center seam reaches the low foot`);
  near(divider.position[1] + divider.scale[1] / 2, CONFIG.monument.emblem.torchBaseTopY, `${faceName} center seam reaches the flower junction`);

  const petals = face.children.filter((child) => child.name.startsWith("LotusPetal"));
  assert.deepEqual(
    petals.map((petal) => petal.name),
    ["LotusPetalCenter", "LotusPetalInnerLeft", "LotusPetalInnerRight", "LotusPetalOuterLeft", "LotusPetalOuterRight"],
    `${faceName} places the five lotus leaves in depth order`,
  );
  for (const petal of petals) {
    const settings = CONFIG.monument.emblem.flowerPetals.find((entry) => petal.name === `LotusPetal${entry.name}`);
    const outline = petal.children.find((child) => child.name === "DarkContour");
    const fill = petal.children.find((child) => child.name === "YellowFace");
    assert.ok(outline?.geometry && fill?.geometry, `${petal.name} has its own outlined filled contour`);
    assert.ok(fill.geometry.vertexCount > 100, `${petal.name} samples a smooth contour and extrusion`);
    assert.equal(fill.geometry.positions.length, fill.geometry.normals.length, `${petal.name} position and normal buffers match`);
    assert.equal(fill.geometry.uvs.length * 3, fill.geometry.positions.length * 2, `${petal.name} position and UV buffers match`);
    assert.ok([...fill.geometry.positions, ...fill.geometry.normals].every(Number.isFinite), `${petal.name} vertices and normals are finite`);
    const fillPositions = constructionPositions(fill);
    const localX = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fillPositions[index * 3]);
    const localY = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fillPositions[index * 3 + 1]);
    assert.ok(Math.max(...localX) - Math.min(...localX) > settings.width * 0.12, `${petal.name} has a visible leaf silhouette`);
    const lowestVisibleY = Math.min(...localY);
    if (petal.name === "LotusPetalCenter") {
      near(lowestVisibleY, 0, `${petal.name} keeps the traced shared-root point`);
    } else {
      assert.ok(
        lowestVisibleY > 0 && lowestVisibleY < 0.04,
        `${petal.name} keeps its source-traced visible endpoint at the painted occlusion seam`,
      );
    }
    assert.ok(Math.max(...localY) > settings.height * 0.8, `${petal.name} reaches its distinct pointed crown`);
    near(petal.position[0], 0, `${petal.name} aligns to the shared profile origin`);
    near(petal.position[1], CONFIG.monument.emblem.flowerBaseY, `${petal.name} converges at the flower root`);
    flowerPetalVertexCount += fill.geometry.vertexCount;
  }
}

const baselineBodyAssembly = findNode(baselineScene, "PlaqueBearingMainBodyAssembly");
const editedBodyAssembly = findNode(editedScene, "PlaqueBearingMainBodyAssembly");
const baselineBody = findNode(baselineScene, "PlaqueBearingMainBody");
const editedBody = findNode(editedScene, "PlaqueBearingMainBody");
const rearTriangle = findNode(baselineScene, "RearRedTriangle");
assert.ok(rearTriangle, "rear red triangle exists");
near(rearTriangle.rotation[2], 180, "rear red triangle is rotated point-down");
assert.deepEqual(baselineConfig.materials.tileAccent.color, [0.18, 0.19, 0.2], "side triangles use their near-black accent color");
const baselineBodyBottom = baselineBodyAssembly.position[1] - baselineBody.scale[1] / 2;
const editedBodyBottom = editedBodyAssembly.position[1] - editedBody.scale[1] / 2;
near(editedBodyBottom, baselineBodyBottom, "main body bottom remains fixed at the plinth top");
near(editedBodyAssembly.position[1] + editedBody.scale[1] / 2 - (baselineBodyAssembly.position[1] + baselineBody.scale[1] / 2), 0.3, "main body top follows the height edit");

for (const [name, expectedY, baselineY] of [
  ["IvoryBand", editedLayout.band.position[1], baselineLayout.band.position[1]],
  ["GrayStoneNeckAssembly", editedLayout.neck.position[1], baselineLayout.neck.position[1]],
  ["BlackCapAndEmblem", editedLayout.cap.position[1], baselineLayout.cap.position[1]],
]) {
  const editedNode = findNode(editedScene, name);
  const baselineNode = findNode(baselineScene, name);
  near(editedNode.position[1], expectedY, `${name} follows the derived edited position`);
  near(editedNode.position[1] - baselineY, 0.3, `${name} follows the full main body height delta`);
}

const bandHeight = editedConfig.monument.band.size[1];
const neckHeight = editedConfig.monument.neck.size[1];
const capHeight = editedConfig.monument.cap.size[1];
near(editedLayout.band.bottomY, editedLayout.mainBody.topY, "cream band starts at the main body top");
near(editedLayout.neck.bottomY, editedLayout.band.topY, "stone neck starts at the cream band top");
near(editedLayout.cap.bottomY, editedLayout.neck.topY, "black cap starts at the stone neck top");
near(editedLayout.band.position[1] - bandHeight / 2, editedLayout.mainBody.topY, "band box bottom meets the main body top");
near(editedLayout.neck.position[1] - neckHeight / 2, editedLayout.band.topY, "neck box bottom meets the cream band top");
near(editedLayout.cap.position[1] - capHeight / 2, editedLayout.neck.topY, "cap box bottom meets the stone neck top");

const bodyWidth = CONFIG.monument.mainBody.size[0];
assert.ok(Math.abs(bodyWidth / CONFIG.monument.mainBody.size[1] - 483 / 450) < 0.02, "main body front silhouette follows the supplied near-square photo ratio");
assert.ok(Math.abs(CONFIG.monument.cap.size[0] / bodyWidth - 0.78) < 0.02, "black cap width follows the supplied approximate front ratio");
near(CONFIG.monument.cap.size[0], 0.87, "black cap keeps its accepted front width");
near(CONFIG.monument.cap.size[1], 0.10, "black cap keeps its accepted structural height");
near(CONFIG.monument.cap.size[2], 0.80, "black cap depth keeps a modest overhang above the gray neck");
assert.ok(Math.abs(CONFIG.monument.neck.size[0] / bodyWidth - 0.56) < 0.02, "gray neck width follows the supplied approximate front ratio");
assert.ok(Math.abs(CONFIG.monument.band.size[0] / bodyWidth - 1.0) < 0.02, "cream trim remains flush with the main body width");
for (const name of ["PlaqueBearingMainBody", "IvoryBand", "GrayStoneNeckBlock", "BlackPolishedCap"]) {
  const layer = findNode(baselineScene, name);
  assert.ok(layer, `${name} exists as a separately named layer`);
  assert.deepEqual(layer.collision, { solid: true, surface: true }, `${name} is solid and contributes a walkable surface`);
  assert.ok([...layer.geometry.positions, ...layer.geometry.normals, ...layer.geometry.uvs].every(Number.isFinite), `${name} geometry buffers are finite`);
}

const capAssembly = findNode(baselineScene, "BlackCapAndEmblem");
const capSize = baselineConfig.monument.cap.size;
const capVeins = capAssembly.children.filter((child) => child.name.startsWith("CapVein"));
assert.deepEqual(
  capVeins.map((vein) => vein.name),
  ["CapVeinMain", "CapVeinBranch", "CapVeinFine"],
  "cap keeps its three decorative veins",
);
const veinMargin = Math.min(capSize[0], capSize[2]) * 0.04;
const capVeinBounds = {};
for (const vein of capVeins) {
  const bounds = localBounds(vein);
  capVeinBounds[vein.name] = bounds;
  assert.ok(Object.values(bounds).every(Number.isFinite), `${vein.name} bounds are finite`);
  assert.ok(bounds.minX >= -capSize[0] / 2 + veinMargin - tolerance, `${vein.name} fits within the cap left face margin`);
  assert.ok(bounds.maxX <= capSize[0] / 2 - veinMargin + tolerance, `${vein.name} fits within the cap right face margin`);
  assert.ok(bounds.minZ >= -capSize[2] / 2 + veinMargin - tolerance, `${vein.name} fits within the cap rear face margin`);
  assert.ok(bounds.maxZ <= capSize[2] / 2 - veinMargin + tolerance, `${vein.name} fits within the cap front face margin`);
  assert.ok(bounds.minY >= -capSize[1] / 2 - tolerance, `${vein.name} stays above the cap bottom`);
  assert.ok(bounds.maxY <= capSize[1] / 2 + 0.002 + tolerance, `${vein.name} stays within the cap top face relief`);
}

const editedEmblem = findNode(editedScene, "EmblemAssembly");
const baselineEmblem = findNode(baselineScene, "EmblemAssembly");
near(worldY(editedScene, editedEmblem), editedLayout.emblem.worldPosition[1], "emblem root follows the derived cap position");
near(worldY(editedScene, editedEmblem) - worldY(baselineScene, baselineEmblem), 0.3, "emblem follows the full main body height delta");

const widerConfig = structuredClone(CONFIG);
widerConfig.monument.steps[0].size[0] += 0.6;
widerConfig.monument.steps[0].size[2] += 0.4;
const widerLayout = deriveMonumentLayout(widerConfig.monument, widerConfig.camera.collisionBoundsMargin);
const baselineBounds = baselineLayout.collisionBounds;
const widerBounds = widerLayout.collisionBounds;
near((widerBounds.maxX - widerBounds.minX) - (baselineBounds.maxX - baselineBounds.minX), 0.6, "collision width follows the wider dominant plinth step");
near((widerBounds.maxZ - widerBounds.minZ) - (baselineBounds.maxZ - baselineBounds.minZ), 0.4, "collision depth follows the deeper dominant plinth step");

const baselineUvDensity = uvRangeForFrontFace(baselineBody.geometry) / baselineBody.scale[1];
const editedUvDensity = uvRangeForFrontFace(editedBody.geometry) / editedBody.scale[1];
near(baselineUvDensity, 1, "baseline main body UV density remains one repeat per scene unit");
near(editedUvDensity, baselineUvDensity, "main body UV density stays consistent after the height edit");

process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mainBodyBottomY: baselineBodyBottom,
  mainBodyHeightDelta: editedBody.scale[1] - baselineBody.scale[1],
  upperPartDelta: 0.3,
  cap: {
    size: baselineConfig.monument.cap.size,
    worldBounds: {
      minX: -capSize[0] / 2,
      maxX: capSize[0] / 2,
      minY: baselineLayout.cap.bottomY,
      maxY: baselineLayout.cap.topY,
      minZ: -capSize[2] / 2,
      maxZ: capSize[2] / 2,
    },
    veinLocalBounds: capVeinBounds,
    veinWorldY: {
      min: baselineLayout.cap.position[1] + Math.min(...Object.values(capVeinBounds).map((bounds) => bounds.minY)),
      max: baselineLayout.cap.position[1] + Math.max(...Object.values(capVeinBounds).map((bounds) => bounds.maxY)),
    },
  },
  collisionBounds: { baseline: baselineBounds, widerPlinth: widerBounds },
  outerPlaza: {
    pavingOutlineBounds: {
      minX: Math.min(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)),
      maxX: Math.max(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)),
      minZ: Math.min(...baselineConfig.plaza.outerPavingOutline.map(([, z]) => z)),
      maxZ: Math.max(...baselineConfig.plaza.outerPavingOutline.map(([, z]) => z)),
    },
    pavingTopY: baselineConfig.plaza.paverTopY,
    groundTopY: baselineConfig.plaza.groundTopY,
    islandRise: baselineConfig.plaza.paverTopY - baselineConfig.plaza.groundTopY,
    paverThickness: baselineConfig.plaza.paverThickness,
    plantingPocketCount: soilPocketNodes.length,
    supportedPlantRoots: soilRootCount,
    annularRows: baselineConfig.plaza.paverRows,
    formerLawnPavingSample: [2.6, -2.8],
    outerCurbSegments: curbSegments.length,
    curbHeightAboveGround: outerCurbTopY - baselineConfig.plaza.groundTopY,
  },
  geometryHelperRegressions: {
    grid: {
      dimensions: [gridProbeWidth, gridProbeDepth],
      groutCounts: [gridColumns - 1, gridRows - 1],
      tileArea: { expected: expectedGridTileArea, actual: measuredGridTileArea },
      groutArea: { expected: expectedGridGroutArea, actual: measuredGridGroutArea },
      totalArea: { expected: gridProbeWidth * gridProbeDepth, actual: measuredGridTileArea + measuredGridGroutArea },
      finalGroutStripCovered: true,
      finalTileRowCovered: true,
    },
    polygonFields: polygonProbeResults,
  },
  uvDensity: { baseline: baselineUvDensity, edited: editedUvDensity },
  whiteSupportPanels: 8,
  whiteSupportVertices: whiteSupportVertexCount,
  goldContourPetals: 10,
  goldContourVertices: flowerPetalVertexCount,
  result: "passed",
}, null, 2) + "\n");
