#!/usr/bin/env node
import assert from "node:assert/strict";
import { CONFIG, deriveMonumentLayout } from "../src/config.js";
import { createMonument, createScene } from "../src/scene.js";

const tolerance = 1e-6;
const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
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

function localBounds(node) {
  const matrix = node.localMatrix();
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

const baselineConfig = structuredClone(CONFIG);
const editedConfig = structuredClone(CONFIG);
editedConfig.monument.mainBody.size[1] += 0.3;

const baselineLayout = deriveMonumentLayout(baselineConfig.monument, baselineConfig.camera.collisionBoundsMargin);
const editedLayout = deriveMonumentLayout(editedConfig.monument, editedConfig.camera.collisionBoundsMargin);
const baselineScene = addParents(createMonument(baselineConfig));
const editedScene = addParents(createMonument(editedConfig));

const plaza = findNode(addParents(createScene()), "Plaza");
const apronTriangles = plaza.children.filter((node) => node.name.startsWith("ApronCorner") || node.name.startsWith("ApronSide"));
assert.equal(apronTriangles.length, 8, "apron has four corner triangles and four side triangles");
for (const triangle of apronTriangles) {
  const isSideTriangle = triangle.name.startsWith("ApronSide");
  assert.equal(triangle.geometry.vertexCount, isSideTriangle ? 24 : 3, `${triangle.name} has the expected ${isSideTriangle ? "solid" : "flat"} triangular geometry`);
  assert.deepEqual(
    triangle.material,
    isSideTriangle ? baselineConfig.materials.tileAccent : baselineConfig.materials.tile,
    `${triangle.name} uses the ${isSideTriangle ? "dark accent" : "apron tile"} material`,
  );
  const vertices = Array.from({ length: 3 }, (_, index) => Array.from(triangle.geometry.positions.slice(index * 3, index * 3 + 3)));
  const edgeLengths = vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return Math.hypot(vertex[0] - next[0], vertex[2] - next[2]);
  });
  assert.ok(Math.max(...edgeLengths) - Math.min(...edgeLengths) <= tolerance, `${triangle.name} is equilateral`);
  if (isSideTriangle) {
    const yCoordinates = Array.from({ length: triangle.geometry.vertexCount }, (_, index) => triangle.geometry.positions[index * 3 + 1]);
    near(Math.max(...yCoordinates) - Math.min(...yCoordinates), baselineConfig.plaza.tilePadSize[1], `${triangle.name} thickness matches the apron`);
    near(triangle.position[1], baselineConfig.plaza.tilePadY, `${triangle.name} is vertically aligned with the apron`);
    const tip = vertices.reduce((furthest, vertex) => {
      const distance = Math.hypot(vertex[0], vertex[2]);
      return distance > Math.hypot(furthest[0], furthest[2]) ? vertex : furthest;
    }, vertices[0]);
    const outwardComponent = triangle.name.endsWith("North") || triangle.name.endsWith("South") ? tip[2] : tip[0];
    const outwardSign = triangle.name.endsWith("North") || triangle.name.endsWith("East") ? 1 : -1;
    assert.ok(outwardComponent * outwardSign > 0, `${triangle.name} points outward from the square`);
  }
}

const planting = findNode(addParents(createScene()), "PlantingGroups");
const spawnFacingPlant = findNode(planting, "NearFrontLeafCluster03");
assert.ok(spawnFacingPlant, "the plant directly ahead of the spawn is a near-front leaf cluster");
const nearFrontBed = findNode(planting, "NearFrontPlantingBed");
const soilBed = findNode(nearFrontBed, "NearFrontPlantingSoilBed");
assert.ok(soilBed, "all spawn-facing plants share one curved soil bed");
assert.equal(soilBed.scale[1], 1, "the curved soil bed keeps its generated thickness");
assert.deepEqual(soilBed.material, baselineConfig.materials.soil, "the planting bed uses the soil material");
const soilYCoordinates = Array.from(
  { length: soilBed.geometry.vertexCount },
  (_, index) => soilBed.geometry.positions[index * 3 + 1],
);
const soilBottomY = Math.min(...soilYCoordinates);
const soilTopY = Math.max(...soilYCoordinates);
near(
  nearFrontBed.position[1] + soilBed.position[1] + soilBottomY,
  baselineConfig.plaza.paverThickness,
  "the planting bed starts at the paving surface",
);
near(
  nearFrontBed.position[1] + soilBed.position[1] + soilTopY,
  nearFrontBed.position[1],
  "near-front plant roots meet the top of the soil bed",
);
for (const cluster of baselineConfig.plants.frontBedClusters) {
  const [x, z] = cluster.position;
  const radius = Math.hypot(x, z);
  const angle = Math.atan2(x, z);
  assert.ok(
    radius - cluster.rootSpread >= baselineConfig.plants.frontBedSoilInnerRadius
      && radius + cluster.rootSpread <= baselineConfig.plants.frontBedSoilOuterRadius,
    "the curved soil bed contains each front-bed plant root area",
  );
  assert.ok(
    angle >= baselineConfig.plants.frontBedSoilStartAngle
      && angle <= baselineConfig.plants.frontBedSoilEndAngle,
    "the curved soil bed follows the full near-front plant row",
  );
}
assert.equal(
  nearFrontBed.children.filter((node) => node.name.startsWith("NearFrontLeafCluster")).length,
  baselineConfig.plants.frontBedClusters.length,
  "all near-front clusters sit in the shared planting bed",
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
    const localX = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fill.geometry.positions[index * 3]);
    const localY = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fill.geometry.positions[index * 3 + 1]);
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
    const localX = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fill.geometry.positions[index * 3]);
    const localY = Array.from({ length: fill.geometry.vertexCount }, (_, index) => fill.geometry.positions[index * 3 + 1]);
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
  uvDensity: { baseline: baselineUvDensity, edited: editedUvDensity },
  whiteSupportPanels: 8,
  whiteSupportVertices: whiteSupportVertexCount,
  goldContourPetals: 10,
  goldContourVertices: flowerPetalVertexCount,
  result: "passed",
}, null, 2) + "\n");
