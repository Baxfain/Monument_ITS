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
    if (x <= minX + tolerance || x >= maxX - tolerance || z <= minZ + tolerance || z >= maxZ - tolerance) continue;
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const first = cross(a, b, [x, z]);
    const second = cross(b, c, [x, z]);
    const third = cross(c, a, [x, z]);
    if ((first > tolerance && second > tolerance && third > tolerance)
      || (first < -tolerance && second < -tolerance && third < -tolerance)) return true;
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

const roadProbeSegment = CONFIG.plaza.roadway.segments[0];
const [roadWidth, roadDepth] = roadProbeSegment.size;
const roadColumns = Math.max(1, Math.round(roadWidth / CONFIG.plaza.roadway.blockSize[0]));
const roadRows = Math.max(1, Math.round(roadDepth / CONFIG.plaza.roadway.blockSize[1]));
const roadGrid = createApronGridGeometry(
  [roadWidth, 1, roadDepth],
  roadColumns - 1,
  CONFIG.plaza.roadway.jointWidth,
  roadRows - 1,
);
const expectedRoadTileArea = (roadWidth - (roadColumns - 1) * CONFIG.plaza.roadway.jointWidth)
  * (roadDepth - (roadRows - 1) * CONFIG.plaza.roadway.jointWidth);
const measuredRoadTileArea = triangleAreaXZ(roadGrid.tiles) * roadWidth * roadDepth;
const expectedRoadGroutArea = roadWidth * roadDepth - expectedRoadTileArea;
const measuredRoadGroutArea = triangleAreaXZ(roadGrid.grout) * roadWidth * roadDepth;
near(measuredRoadTileArea, expectedRoadTileArea, "rectangular roadway tile area accounts for every row and column joint", 1e-5);
near(
  measuredRoadGroutArea,
  expectedRoadGroutArea,
  "rectangular roadway grout covers the full complement of tile area",
  1e-5,
);
near(measuredRoadTileArea + measuredRoadGroutArea, roadWidth * roadDepth, "roadway tiles and grout cover the full rectangular footprint", 1e-5);
const lastRoadJointZ = -0.5 + (roadRows - 1) / roadRows;
const finalRoadTileCenterZ = -0.5 + (roadRows - 0.5) / roadRows;
assert.ok(geometryCoversXZ(roadGrid.grout, 0.05, lastRoadJointZ), "the final second-axis roadway grout strip is present");
assert.ok(geometryCoversXZ(roadGrid.tiles, 0.05, finalRoadTileCenterZ), "the final roadway tile row reaches the segment edge");
assert.ok(!geometryCoversXZ(roadGrid.grout, 0.05, finalRoadTileCenterZ), "the final roadway tile row remains tile rather than grout");

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
const circularApron = findNode(plaza, "CircularPavingApron");
assert.ok(circularApron?.geometry, "the monument foot has a separate circular paved apron");
assert.equal(findNode(plaza, "SquarePavingApron"), null, "the former square apron is absent");
assert.equal(plaza.children.filter((node) => node.name.startsWith("ApronSide")).length, 0, "the former square apron triangles are absent");
assert.equal(circularApron.collision, null, "the circular apron backing does not create hidden top support");
assert.deepEqual(circularApron.material, baselineConfig.materials.tile, "the circular apron keeps the tile material");

const apronRadius = baselineConfig.plaza.tilePadRadius;
const apronPositions = constructionPositions(circularApron);
const apronBoundaryRadii = [];
for (let index = 0; index < apronPositions.length; index += 3) {
  const radius = Math.hypot(apronPositions[index], apronPositions[index + 2]);
  assert.ok(radius <= apronRadius + tolerance, "the apron geometry stays within its circular footprint");
  if (radius >= apronRadius - tolerance * 4) apronBoundaryRadii.push(radius);
}
assert.ok(apronBoundaryRadii.length >= 128, "the apron has a sampled round outer boundary");
near(Math.min(...apronBoundaryRadii), apronRadius, "the apron circular boundary reaches its configured radius");
near(Math.max(...apronBoundaryRadii), apronRadius, "the apron boundary does not flare into square corners");
assert.ok(geometryCoversXZ(circularApron.geometry, 0.9, 0.3, circularApron.objectToConstruction), "the circular apron covers a point inside its round footprint");
assert.ok(!geometryCoversXZ(circularApron.geometry, 1.25, 1.25, circularApron.objectToConstruction), "the circular apron leaves diagonal gravel outside its round footprint");
const apronBounds = localBounds(circularApron);
near(apronBounds.maxX, apronRadius, "the apron has a circular east extent");
near(apronBounds.minX, -apronRadius, "the apron has a circular west extent");
near(apronBounds.maxZ, apronRadius, "the apron has a circular north extent");
near(apronBounds.minZ, -apronRadius, "the apron has a circular south extent");

const apronTiles = findNode(plaza, "ApronTileSurfaces");
const apronGrout = findNode(plaza, "ApronGroutSurface");
assert.ok(apronTiles?.geometry && apronGrout?.geometry, "the circular apron keeps its separate tile and grout surfaces");
for (const surface of [apronTiles, apronGrout]) {
  assert.deepEqual(surface.collision, { surface: true }, `${surface.name} remains walkable`);
  const positions = constructionPositions(surface);
  for (let index = 0; index < positions.length; index += 3) {
    assert.ok(Math.hypot(positions[index], positions[index + 2]) <= apronRadius + tolerance, `${surface.name} is clipped to the circle`);
  }
}
assert.ok(geometryCoversXZ(apronTiles.geometry, 0.2, 0.2, apronTiles.objectToConstruction), "clipped paving tiles remain visible within the circular apron");
assert.ok(!geometryCoversXZ(apronTiles.geometry, 1.25, 1.25, apronTiles.objectToConstruction), "clipped paving tiles do not extend beyond the circular apron");
near(worldY(scene, apronTiles), baselineConfig.plaza.tilePadY + baselineConfig.plaza.tilePadSize[1] / 2, "tile surfaces remain at the apron top");
const expectedApronBackingTopOffset = 0.0001;
const apronBackingPositions = constructionPositions(circularApron);
let apronBackingBottomY = Infinity;
let apronBackingTopY = -Infinity;
for (let index = 1; index < apronBackingPositions.length; index += 3) {
  apronBackingBottomY = Math.min(apronBackingBottomY, apronBackingPositions[index]);
  apronBackingTopY = Math.max(apronBackingTopY, apronBackingPositions[index]);
}
apronBackingBottomY += worldY(scene, circularApron);
apronBackingTopY += worldY(scene, circularApron);
near(
  apronBackingBottomY,
  baselineConfig.plaza.tilePadY - baselineConfig.plaza.tilePadSize[1] / 2,
  "apron backing keeps its original bottom height",
);
for (const surface of [apronTiles, apronGrout]) {
  const positions = constructionPositions(surface);
  let surfaceTopY = -Infinity;
  for (let index = 1; index < positions.length; index += 3) {
    surfaceTopY = Math.max(surfaceTopY, positions[index]);
  }
  const worldSurfaceTopY = worldY(scene, surface) + surfaceTopY;
  assert.ok(apronBackingTopY < worldSurfaceTopY, `${surface.name} is above the apron backing top`);
  near(
    worldSurfaceTopY - apronBackingTopY,
    expectedApronBackingTopOffset,
    `${surface.name} clears the apron backing by the intended offset`,
  );
}
const tilePositions = constructionPositions(apronTiles);
for (let index = 0; index < apronTiles.geometry.vertexCount; index += 1) {
  near(
    apronTiles.geometry.uvs[index * 2],
    tilePositions[index * 3] + baselineConfig.plaza.tilePadSize[0] / 2,
    `apron tile ${index} U coordinate follows restored construction-space X`,
  );
  near(
    apronTiles.geometry.uvs[index * 2 + 1],
    tilePositions[index * 3 + 2] + baselineConfig.plaza.tilePadSize[2] / 2,
    `apron tile ${index} V coordinate follows restored construction-space Z`,
  );
}

const planting = findNode(scene, "PlantingGroups");
assert.ok(planting, "separate landscape planting groups remain in the scene");
assert.equal(findNode(scene, "NearFrontPlantingBed"), null, "the former continuous planting bed is removed");
const pocketSettings = baselineConfig.plants.plantingPockets;
const soilPocketNodes = planting.children.filter((node) => pocketSettings.some((pocket) => pocket.name === node.name));
assert.equal(soilPocketNodes.length, pocketSettings.length, "each configured planting pocket has its own landscape group");
const annularPavingNodes = plaza.children.filter((node) =>
  node.name.startsWith("PaverAnnulusTiles")
  || node.name.startsWith("PaverArcJoint")
  || node.name.startsWith("PaverRadialJoint"));
const outerPavingTiles = findNode(plaza, "OuterPavingFieldTiles");
const outerPavingGrout = findNode(plaza, "OuterPavingFieldGrout");
assert.ok(outerPavingTiles?.geometry && outerPavingGrout?.geometry, "the shaped paving field has separate tile and grout surfaces");
assert.ok(geometryCoversXZ(outerPavingTiles.geometry, 0.32, 9.1, outerPavingTiles.objectToConstruction), "the shaped paving continues along the front entrance path");
const outerFieldBounds = localBounds(outerPavingTiles);
near(outerFieldBounds.minX, Math.min(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)), "outer paving field stays inside its west edge");
near(outerFieldBounds.maxX, Math.max(...baselineConfig.plaza.outerPavingOutline.map(([x]) => x)), "outer paving field stays inside its east edge");
near(outerFieldBounds.minZ, Math.min(...baselineConfig.plaza.outerPavingOutline.map(([, z]) => z)), "outer paving field stays inside its rear edge");
near(outerFieldBounds.maxZ, Math.max(...baselineConfig.plaza.outerPavingOutline.map(([, z]) => z)), "outer paving field stays inside its entrance edge");
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
  const bed = findNode(planting, pocket.name);
  const soilBed = findNode(bed, `${pocket.name}SoilSurface`);
  assert.ok(soilBed?.geometry, `${pocket.name} has its own soil surface mesh`);
  assert.deepEqual(soilBed.material, baselineConfig.materials.soil, `${pocket.name} uses the soil material`);
  assert.ok(soilBed.geometry.vertexCount > 0, `${pocket.name} soil surface contains real geometry`);
  const soilPositions = constructionPositions(soilBed);
  const localY = Array.from(
    { length: soilBed.geometry.vertexCount },
    (_, index) => soilPositions[index * 3 + 1],
  );
  near(worldY(scene, soilBed) + Math.max(...localY), baselineConfig.plants.soilSurfaceY, `${pocket.name} soil top supports its roots`);
  near(worldY(scene, soilBed) + Math.min(...localY), baselineConfig.plaza.groundTopY, `${pocket.name} soil base meets the ground`);

  for (const [clusterIndex, cluster] of pocket.clusters.entries()) {
    const [x, z] = cluster.position;
    const group = findNode(bed, `LeafCluster${String(clusterIndex + 1).padStart(2, "0")}`);
    assert.ok(group, `${pocket.name} cluster ${clusterIndex + 1} is nested in its own pocket`);
    near(group.position[1], baselineConfig.plants.soilSurfaceY, `${pocket.name} cluster ${clusterIndex + 1} root elevation`);
    assert.ok(geometryCoversXZ(soilBed.geometry, x, z, soilBed.objectToConstruction), `${pocket.name} soil covers cluster ${clusterIndex + 1} root`);
    assert.ok(!geometryCoversXZ(outerPavingTiles.geometry, x, z, outerPavingTiles.objectToConstruction), `${pocket.name} root is an opening in outer paving`);
    assert.ok(!geometryCoversXZ(outerPavingGrout.geometry, x, z, outerPavingGrout.objectToConstruction), `${pocket.name} root is clear of outer paving joints`);
    assert.ok(!annularPavingNodes.some((node) => geometryCoversXZ(node.geometry, x, z, node.objectToConstruction)), `${pocket.name} root is clear of annular tiles and joints`);
    assert.ok(
      Math.hypot(x, z) - cluster.rootSpread > baselineConfig.plaza.paverOuterRadius,
      `${pocket.name} root spread stays outside the circular paving band`,
    );
    soilRootCount += 1;
  }
}

const lawn = findNode(plaza, "RearRightPatchyLawn");
assert.ok(lawn?.geometry, "the rear-right lawn has a separate surface mesh");
assert.deepEqual(lawn.material, baselineConfig.materials.lawn, "the rear-right lawn uses the patchy grass texture");
const lawnPositions = constructionPositions(lawn);
const lawnLocalY = Array.from({ length: lawn.geometry.vertexCount }, (_, index) => lawnPositions[index * 3 + 1]);
near(worldY(scene, lawn) + Math.max(...lawnLocalY), baselineConfig.plaza.islandLawnTopY, "patchy lawn top follows the planting level");
near(worldY(scene, lawn) + Math.min(...lawnLocalY), baselineConfig.plaza.groundTopY, "patchy lawn base meets the ground");
const lawnSample = [5.3, -5.2];
const lawnAnnulusSample = [3.6, -4.1];
assert.ok(geometryCoversXZ(lawn.geometry, ...lawnSample, lawn.objectToConstruction), "the patchy lawn covers its configured rear-right sample");
assert.ok(!geometryCoversXZ(outerPavingTiles.geometry, ...lawnSample, outerPavingTiles.objectToConstruction), "paving leaves a real opening for the patchy lawn");
assert.ok(!annularPavingNodes.some((node) => geometryCoversXZ(node.geometry, ...lawnSample, node.objectToConstruction)), "annular pavers do not mask the lawn");
assert.ok(geometryCoversXZ(lawn.geometry, ...lawnAnnulusSample, lawn.objectToConstruction), "the lawn continues into its configured overlap with the circular band");
assert.ok(!geometryCoversXZ(outerPavingTiles.geometry, ...lawnAnnulusSample, outerPavingTiles.objectToConstruction), "the lawn opening also cuts through the shaped outer field");
assert.ok(!annularPavingNodes.some((node) => geometryCoversXZ(node.geometry, ...lawnAnnulusSample, node.objectToConstruction)), "annular pavers leave a true opening where the lawn crosses their radius");

const curbSegments = plaza.children.filter((node) => node.name.startsWith("OuterRoadsideCurb"));
assert.ok(curbSegments.length > 80, "the outer roadside curb is built from many short individual segments");
assert.ok(!curbSegments.some((node) => node.name.startsWith("OuterRoadsideCurb06_")), "the front curb remains open across the entrance");
for (const segment of curbSegments) {
  assert.deepEqual(segment.material, baselineConfig.materials.outerCurb, `${segment.name} uses the dark outer curb material`);
  assert.deepEqual(segment.collision, { solid: true, surface: true }, `${segment.name} provides solid low-step support`);
}
const innerCurb = findNode(plaza, "RaisedCircularCurb");
assert.ok(innerCurb, "the pale central gravel curb remains a distinct circular feature");
assert.notDeepEqual(innerCurb.material, baselineConfig.materials.outerCurb, "the inner gravel curb and outer roadside curb use distinct materials");
const outerCurbTopY = baselineConfig.plaza.outerRoadsideCurb.baseY + baselineConfig.plaza.outerRoadsideCurb.height;
near(outerCurbTopY - baselineConfig.plaza.entrance.roadTopY, baselineConfig.plaza.outerRoadsideCurb.height, "outer curb rise is measured from the adjacent road");
assert.ok(
  outerCurbTopY - baselineConfig.plaza.entrance.roadTopY <= baselineConfig.camera.maxStepHeight,
  "the segmented outer curb remains within the configured walking step height",
);

const roadBounds = baselineConfig.plaza.roadway.segments.map((segment) => ({
  name: segment.name,
  minX: segment.position[0] - segment.size[0] / 2,
  maxX: segment.position[0] + segment.size[0] / 2,
  minZ: segment.position[1] - segment.size[1] / 2,
  maxZ: segment.position[1] + segment.size[1] / 2,
}));
for (const [index, segment] of baselineConfig.plaza.roadway.segments.entries()) {
  const tiles = findNode(plaza, segment.name);
  const joints = findNode(plaza, `${segment.name}JointSurface`);
  assert.ok(tiles?.geometry && joints?.geometry, `${segment.name} has separate block and joint meshes`);
  assert.deepEqual(tiles.material, baselineConfig.materials.road, `${segment.name} uses the dark roadway material`);
  assert.deepEqual(joints.material, baselineConfig.materials.roadJoint, `${segment.name} uses the roadway joint material`);
  assert.deepEqual(tiles.collision, { surface: true }, `${segment.name} supplies walkable road support`);
  near(tiles.position[1], baselineConfig.plaza.entrance.roadTopY, `${segment.name} sits at road elevation`);
  near(tiles.scale[0], segment.size[0], `${segment.name} width follows the layout parameter`);
  near(tiles.scale[2], segment.size[1], `${segment.name} depth follows the layout parameter`);

  for (const other of roadBounds.slice(index + 1)) {
    const overlapX = Math.min(roadBounds[index].maxX, other.maxX) - Math.max(roadBounds[index].minX, other.minX);
    const overlapZ = Math.min(roadBounds[index].maxZ, other.maxZ) - Math.max(roadBounds[index].minZ, other.minZ);
    assert.ok(overlapX <= tolerance || overlapZ <= tolerance, `${segment.name} does not overlap ${other.name}`);
  }
}
assert.ok(findNode(plaza, "RoadwayRearBlocks"), "dark block road closes the rear side of the island");
assert.ok(findNode(plaza, "RoadwayThresholdBaseBlocks"), "the entrance lip seats on a short matching road base");

const entrance = baselineConfig.plaza.entrance;
const threshold = findNode(plaza, "EntranceThresholdLip");
const ramp = findNode(plaza, "EntranceAccessRamp");
assert.ok(threshold?.geometry && ramp?.geometry, "the entrance has a local lip and sloped access ramp");
assert.deepEqual(threshold.collision, { solid: true, surface: true }, "the entrance lip is a solid walkable step");
near(threshold.scale[0], entrance.pathWidth, "entrance lip width matches the access path");
near(threshold.scale[2], entrance.thresholdDepth, "entrance lip depth follows its layout parameter");
near(threshold.position[1] - threshold.scale[1] / 2, entrance.roadTopY, "entrance lip bottom meets the road");
near(threshold.position[1] + threshold.scale[1] / 2, baselineConfig.plaza.paverTopY, "entrance lip top meets the pavers");
const rampConstructionPositions = constructionPositions(ramp);
const rampPoints = Array.from({ length: ramp.geometry.vertexCount }, (_, index) => [
  rampConstructionPositions[index * 3],
  ramp.position[1] + rampConstructionPositions[index * 3 + 1],
  ramp.position[2] + rampConstructionPositions[index * 3 + 2],
]);
const rampHighEnd = rampPoints.filter((point) => Math.abs(point[2] - entrance.rampStartZ) <= tolerance);
const rampLowEnd = rampPoints.filter((point) => Math.abs(point[2] - entrance.rampEndZ) <= tolerance);
near(Math.min(...rampHighEnd.map((point) => point[1])), baselineConfig.plaza.paverTopY, "ramp high end meets the paver path");
near(Math.max(...rampLowEnd.map((point) => point[1])), entrance.roadTopY, "ramp low end meets the road");
assert.deepEqual(ramp.collision, { surface: true }, "the access ramp is walkable without a blocking wall");
const thresholdBase = baselineConfig.plaza.roadway.segments.find((segment) => segment.name === "RoadwayThresholdBaseBlocks");
near(thresholdBase.position[1] - thresholdBase.size[1] / 2, entrance.thresholdCenterZ - entrance.thresholdDepth / 2, "road base meets the lip at its rear edge");
near(thresholdBase.position[1] + thresholdBase.size[1] / 2, entrance.thresholdCenterZ + entrance.thresholdDepth / 2, "road base meets the ramp at its front edge");

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
assert.deepEqual(baselineConfig.materials.tileAccent.color, [0.18, 0.19, 0.2], "side triangles use the softened gray accent color");
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
    roadTopY: baselineConfig.plaza.entrance.roadTopY,
    islandRise: baselineConfig.plaza.paverTopY - baselineConfig.plaza.entrance.roadTopY,
    paverThickness: baselineConfig.plaza.paverThickness,
    plantingPocketCount: soilPocketNodes.length,
    supportedPlantRoots: soilRootCount,
    annularRows: baselineConfig.plaza.paverRows,
    patchyLawnSample: lawnSample,
    lawnAnnulusSample,
    outerCurbSegments: curbSegments.length,
    curbHeightAboveRoad: outerCurbTopY - baselineConfig.plaza.entrance.roadTopY,
    roadSegments: roadBounds.length,
    entrance: {
      width: entrance.pathWidth,
      rampDepth: entrance.rampDepth,
      thresholdDepth: entrance.thresholdDepth,
      thresholdDrop: baselineConfig.plaza.paverTopY - entrance.roadTopY,
    },
  },
  geometryHelperRegressions: {
    roadGrid: {
      dimensions: [roadWidth, roadDepth],
      groutCounts: [roadColumns - 1, roadRows - 1],
      tileArea: { expected: expectedRoadTileArea, actual: measuredRoadTileArea },
      groutArea: { expected: expectedRoadGroutArea, actual: measuredRoadGroutArea },
      totalArea: { expected: roadWidth * roadDepth, actual: measuredRoadTileArea + measuredRoadGroutArea },
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
