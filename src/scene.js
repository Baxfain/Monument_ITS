import { CONFIG, deriveMonumentLayout } from "./config.js";
import {
  createBoxGeometry,
  createDiscGeometry,
  createAnnularSectorPrismGeometry,
  createExtrudedContourGeometry,
  createExtrudedPolygonGeometry,
  createLeafClusterGeometry,
  createOutlinedEmblemPetal,
  createRingPrismGeometry,
  createSphereGeometry,
  createTrianglePadGeometry,
  createVerticalGearRingGeometry,
} from "./geometry.js";
import { SceneNode } from "./scene-node.js";

const C = CONFIG;
const texturedBoxCache = new Map();

function mesh(name, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], collision = null) {
  return new SceneNode({ name, geometry, material, position, scale, rotation, collision });
}

function addBox(parent, name, geometry, material, position, size, rotation = [0, 0, 0], collision = null) {
  let boxGeometry = geometry;
  if (material?.texture) {
    const key = size.join(",");
    if (!texturedBoxCache.has(key)) texturedBoxCache.set(key, createBoxGeometry(size));
    boxGeometry = texturedBoxCache.get(key);
  }
  return parent.add(mesh(name, boxGeometry, material, position, size, rotation, collision));
}

function addExtrudedShape(parent, name, points, material, position, depth = 0.006, collision = null) {
  return parent.add(mesh(name, createExtrudedPolygonGeometry(points, depth), material, position, [1, 1, 1], [0, 0, 0], collision));
}

function scaledPoints(points, factor) {
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  return points.map(([x, y]) => [center[0] + (x - center[0]) * factor, center[1] + (y - center[1]) * factor]);
}

function addOuterPaving(plaza, boxGeometry) {
  const settings = C.plaza;
  const span = settings.paverOuterRadius - settings.paverInnerRadius;
  const rowWidth = span / settings.paverRows;
  const jointY = settings.paverThickness + 0.002;
  const jointHeight = 0.004;
  const paving = createRingPrismGeometry(settings.paverInnerRadius, settings.paverOuterRadius, settings.paverThickness, 128);
  plaza.add(mesh("ConcentricOuterPaving", paving, C.materials.paving, [0, settings.paverThickness / 2, 0], [1, 1, 1], [0, 0, 0], { surface: true }));

  for (let row = 1; row < settings.paverRows; row += 1) {
    const radius = settings.paverInnerRadius + rowWidth * row;
    const joint = createRingPrismGeometry(radius - settings.paverJointWidth / 2, radius + settings.paverJointWidth / 2, jointHeight, 128);
    plaza.add(mesh(`PaverArcJoint${row}`, joint, C.materials.grout, [0, jointY + jointHeight / 2, 0], [1, 1, 1], [0, 0, 0], { surface: true }));
  }

  for (let row = 0; row < settings.paverRows; row += 1) {
    const inner = settings.paverInnerRadius + rowWidth * row + settings.paverJointWidth;
    const outer = settings.paverInnerRadius + rowWidth * (row + 1) - settings.paverJointWidth;
    const middle = (inner + outer) / 2;
    const length = outer - inner;
    const offset = row % 2 === 0 ? 0 : 0.5;
    for (let index = 0; index < settings.paverSectors; index += 1) {
      const angle = ((index + offset) / settings.paverSectors) * Math.PI * 2;
      const degrees = (-angle * 180) / Math.PI;
      addBox(
        plaza,
        `PaverRadialJoint${row}_${String(index + 1).padStart(2, "0")}`,
        boxGeometry,
        C.materials.grout,
        [Math.cos(angle) * middle, jointY + jointHeight / 2, Math.sin(angle) * middle],
        [length, jointHeight, settings.paverJointWidth],
        [0, degrees, 0],
        { surface: true },
      );
    }
  }
}

function addPlaza(root, boxGeometry) {
  const plaza = root.add(new SceneNode({ name: "Plaza" }));
  addBox(plaza, "GroundPlane", boxGeometry, C.materials.earth, [0, -0.13, 0], C.plaza.groundSize, [0, 0, 0], { surface: true, perimeter: true });
  addOuterPaving(plaza, boxGeometry);

  const gravel = createDiscGeometry(C.plaza.gravelRadius, 72);
  plaza.add(mesh("CircularGravelBed", gravel, C.materials.gravel, [0, 0.055, 0], [1, 1, 1], [0, 0, 0], { surface: true }));

  const curb = createRingPrismGeometry(C.plaza.curbInnerRadius, C.plaza.curbOuterRadius, C.plaza.curbHeight, 72);
  plaza.add(mesh("RaisedCircularCurb", curb, C.materials.curb, [0, 0.105, 0], [1, 1, 1], [0, 0, 0], { solid: true, surface: true, shape: "annulus" }));

  addBox(plaza, "SquarePavingApron", boxGeometry, C.materials.tile, [0, C.plaza.tilePadY, 0], C.plaza.tilePadSize, [0, 0, 0], { surface: true });
  const padTop = C.plaza.tilePadY + C.plaza.tilePadSize[1] / 2 + 0.002;
  const padHalfX = C.plaza.tilePadSize[0] / 2;
  const padHalfZ = C.plaza.tilePadSize[2] / 2;
  const groutCount = C.plaza.tileGroutCount;
  for (let index = 1; index <= groutCount; index += 1) {
    const x = -padHalfX + (C.plaza.tilePadSize[0] * index) / (groutCount + 1);
    const z = -padHalfZ + (C.plaza.tilePadSize[2] * index) / (groutCount + 1);
    addBox(plaza, `ApronGroutNorthSouth${index}`, boxGeometry, C.materials.grout, [x, padTop, 0], [C.plaza.tileGroutWidth, 0.004, C.plaza.tilePadSize[2]], [0, 0, 0], { surface: true });
    addBox(plaza, `ApronGroutEastWest${index}`, boxGeometry, C.materials.grout, [0, padTop, z], [C.plaza.tilePadSize[0], 0.004, C.plaza.tileGroutWidth], [0, 0, 0], { surface: true });
  }

  const span = C.plaza.triangleSpan;
  const triangleHeight = (span * Math.sqrt(3)) / 2;
  const corners = [
    { name: "ApronCornerNorthEast", position: [padHalfX, padTop + 0.002, padHalfZ], points: [[0, 0], [-span, 0], [-span / 2, -triangleHeight]] },
    { name: "ApronCornerNorthWest", position: [-padHalfX, padTop + 0.002, padHalfZ], points: [[0, 0], [span, 0], [span / 2, -triangleHeight]] },
    { name: "ApronCornerSouthEast", position: [padHalfX, padTop + 0.002, -padHalfZ], points: [[0, 0], [-span, 0], [-span / 2, triangleHeight]] },
    { name: "ApronCornerSouthWest", position: [-padHalfX, padTop + 0.002, -padHalfZ], points: [[0, 0], [span, 0], [span / 2, triangleHeight]] },
  ];
  const sides = [
    { name: "ApronSideNorth", position: [0, padTop + 0.002, padHalfZ], points: [[-span / 2, 0], [span / 2, 0], [0, triangleHeight]] },
    { name: "ApronSideSouth", position: [0, padTop + 0.002, -padHalfZ], points: [[-span / 2, 0], [span / 2, 0], [0, -triangleHeight]] },
    { name: "ApronSideEast", position: [padHalfX, padTop + 0.002, 0], points: [[0, -span / 2], [0, span / 2], [triangleHeight, 0]] },
    { name: "ApronSideWest", position: [-padHalfX, padTop + 0.002, 0], points: [[0, -span / 2], [0, span / 2], [-triangleHeight, 0]] },
  ];
  for (const triangle of corners) {
    plaza.add(mesh(triangle.name, createTrianglePadGeometry(triangle.points), C.materials.tile, triangle.position, [1, 1, 1], [0, 0, 0], { surface: true }));
  }
  for (const triangle of sides) {
    plaza.add(mesh(
      triangle.name,
      createTrianglePadGeometry(triangle.points, C.plaza.tilePadSize[1]),
      C.materials.tileAccent,
      [triangle.position[0], C.plaza.tilePadY, triangle.position[2]],
      [1, 1, 1],
      [0, 0, 0],
      { surface: true },
    ));
  }
  return plaza;
}

function addPlaque(body, boxGeometry, config = CONFIG) {
  const settings = config.monument.plaque;
  const plaque = body.add(new SceneNode({ name: "Plaque", position: settings.position }));
  addBox(plaque, "PlaqueDarkInset", boxGeometry, config.materials.lettering, [0, 0, 0], [settings.frameSize[0] + 0.025, settings.frameSize[1] + 0.025, 0.026], [0, 0, 0], { solid: true });
  addBox(plaque, "PlaqueFrame", boxGeometry, config.materials.plaqueFrame, [0, 0, 0.018], settings.frameSize, [0, 0, 0], { solid: true });
  const photoMaterial = {
    ...config.materials.plaque,
    textureRepeat: [1 / settings.panelSize[0], 1 / settings.panelSize[1]],
  };
  addBox(plaque, "PlaquePanel", boxGeometry, photoMaterial, [0, 0, 0.052], settings.panelSize, [0, 0, 0], { solid: true });
  return plaque;
}

function addTorch(face, boxGeometry, config = CONFIG) {
  const outline = config.materials.emblemOutline;
  const settings = config.monument.emblem;
  for (const panel of settings.torchBasePanels) {
    const profile = settings.torchBaseContours[panel.contour];
    const group = face.add(new SceneNode({ name: `TorchBase${panel.name}`, position: panel.position }));
    const contourDepth = settings.torchBasePetalDepth;
    const { fill, outline: contourOutline } = createOutlinedEmblemPetal(
      profile,
      panel.width,
      panel.height,
      contourDepth,
      panel.mirrorX,
      settings.torchBaseOutlineWidth,
    );
    group.add(mesh(
      "DarkContour",
      contourOutline,
      outline,
      [0, 0, settings.torchBaseOutlineZOffset],
      [1, 1, 1],
      [0, 0, 0],
      { solid: true },
    ));
    group.add(mesh(
      "SilverFold",
      fill,
      config.materials.torchHighlight,
      [0, 0, settings.torchBaseFillZOffset],
      [1, 1, 1],
      [0, 0, 0],
      { solid: true },
    ));
  }
  addBox(
    face,
    "TorchBaseDivider",
    boxGeometry,
    outline,
    [0, (settings.torchBaseBottomY + settings.torchBaseTopY) / 2, settings.torchBaseDividerZ],
    [settings.torchBaseDividerWidth, settings.torchBaseTopY - settings.torchBaseBottomY, 0.006],
    [0, 0, 0],
    { solid: true },
  );

  const halfStem = settings.torchStemWidth / 2;
  const stem = [
    [-halfStem, settings.torchStemBaseY],
    [-halfStem * 0.92, settings.torchStemTopY],
    [halfStem * 0.92, settings.torchStemTopY],
    [halfStem, settings.torchStemBaseY],
  ];
  addExtrudedShape(face, "TorchStemOutline", scaledPoints(stem, 1.24), outline, [0, 0, 0.006], 0.008, { solid: true });
  addExtrudedShape(face, "TorchStem", stem, config.materials.torchHighlight, [0, 0, 0.011], 0.008, { solid: true });

  const halfHead = settings.torchHeadWidth / 2;
  const headChamfer = halfHead * 0.3;
  const head = [
    [-halfHead, settings.torchHeadBottomY],
    [-halfHead, settings.torchTopY - headChamfer],
    [-halfHead + headChamfer, settings.torchTopY],
    [halfHead - headChamfer, settings.torchTopY],
    [halfHead, settings.torchTopY - headChamfer],
    [halfHead, settings.torchHeadBottomY],
  ];
  addExtrudedShape(face, "TorchHeadOutline", scaledPoints(head, 1.18), outline, [0, 0, 0.006], 0.008, { solid: true });
  addExtrudedShape(face, "TorchHeadCap", head, config.materials.torchHighlight, [0, 0, 0.011], 0.008, { solid: true });

  const fluteHeight = settings.torchStemTopY - settings.torchStemBaseY - 0.04;
  const fluteY = (settings.torchStemTopY + settings.torchStemBaseY) / 2;
  for (const side of [-1, 1]) {
    addBox(
      face,
      `TorchFlute${side < 0 ? "Left" : "Right"}`,
      boxGeometry,
      outline,
      [side * settings.torchFluteOffset, fluteY, 0.02],
      [settings.torchFluteWidth, fluteHeight, 0.006],
      [0, 0, 0],
      { solid: true },
    );
  }
  addBox(
    face,
    "TorchCrossbar",
    boxGeometry,
    outline,
    [0, settings.torchHeadBottomY + 0.008, 0.02],
    [settings.torchHeadWidth * 0.9, 0.012, 0.006],
    [0, 0, 0],
    { solid: true },
  );
}

function addLotus(face, config = CONFIG) {
  const settings = config.monument.emblem;
  for (const petal of settings.flowerPetals) {
    const group = face.add(new SceneNode({
      name: `LotusPetal${petal.name}`,
      position: petal.position,
    }));
    const profile = settings.flowerContourProfiles[petal.contour];
    const { fill, outline } = createOutlinedEmblemPetal(
      profile,
      petal.width,
      petal.height,
      settings.flowerPetalDepth,
      petal.mirrorX,
      settings.flowerOutlineWidth,
    );
    group.add(mesh("DarkContour", outline, config.materials.emblemOutline, [0, 0, 0.009], [1, 1, 1], [0, 0, 0], { solid: true }));
    group.add(mesh("YellowFace", fill, petal.name === "Center" ? config.materials.lotusHighlight : config.materials.lotus, [0, 0, 0.015], [1, 1, 1], [0, 0, 0], { solid: true }));
  }
}

function addEmblem(assembly, boxGeometry, config = CONFIG) {
  const settings = config.monument.emblem;
  const layout = deriveMonumentLayout(config.monument);
  const emblem = assembly.add(new SceneNode({ name: "EmblemAssembly", position: layout.emblem.capLocalPosition }));
  const backing = createVerticalGearRingGeometry({
    innerRadius: settings.ringInnerRadius - settings.ringOutlineInnerWidth,
    baseRadius: settings.ringOutlineOuterRadius,
    toothRadius: settings.toothRadius + 0.025,
    depth: settings.ringDepth,
    toothCount: settings.toothCount,
    samplesPerTooth: 32,
  });
  emblem.add(mesh("OpenGearRingBacking", backing, config.materials.emblemOutline, [0, settings.ringCenterY, 0], [1, 1, 1], [0, 0, 0], { solid: true }));

  const navyHalf = createVerticalGearRingGeometry({
    innerRadius: settings.ringInnerRadius,
    baseRadius: settings.ringOuterRadius,
    toothRadius: settings.toothRadius,
    depth: 0.006,
    startAngle: Math.PI / 2,
    endAngle: Math.PI * 1.5,
    toothCount: settings.toothCount,
    samplesPerTooth: 32,
  });
  const cyanHalf = createVerticalGearRingGeometry({
    innerRadius: settings.ringInnerRadius,
    baseRadius: settings.ringOuterRadius,
    toothRadius: settings.toothRadius,
    depth: 0.006,
    startAngle: -Math.PI / 2,
    endAngle: Math.PI / 2,
    toothCount: settings.toothCount,
    samplesPerTooth: 32,
  });

  const front = emblem.add(new SceneNode({ name: "EmblemFaceFront", position: [0, 0, settings.faceOffset] }));
  const rear = emblem.add(new SceneNode({
    name: "EmblemFaceRear",
    position: [0, 0, -settings.faceOffset],
    rotation: [0, 180, 0],
  }));
  for (const face of [front, rear]) {
    face.add(mesh("GearRingLeftHalf", navyHalf, config.materials.emblemNavy, [0, settings.ringCenterY, 0], [1, 1, 1], [0, 0, 0], { solid: true }));
    face.add(mesh("GearRingRightHalf", cyanHalf, config.materials.emblemCyan, [0, settings.ringCenterY, 0], [1, 1, 1], [0, 0, 0], { solid: true }));
    addTorch(face, boxGeometry, config);
    addLotus(face, config);
  }
  return emblem;
}

function addCapVeins(capAssembly, boxGeometry, config = CONFIG) {
  const [width, height, depth] = config.monument.cap.size;
  const widthScale = width / 0.87;
  const depthScale = depth / 0.87;
  const veinHeight = Math.min(height * 0.03, 0.003);
  const faceLift = Math.min(height * 0.02, 0.002);
  const y = height / 2 + faceLift - veinHeight / 2;
  const pattern = [
    { name: "CapVeinMain", center: [-0.09, 0.04], length: 0.54, depth: 0.008, yaw: -18 },
    { name: "CapVeinBranch", center: [0.12, -0.04], length: 0.28, depth: 0.006, yaw: 34 },
    { name: "CapVeinFine", center: [-0.27, -0.12], length: 0.2, depth: 0.005, yaw: 23 },
  ];
  for (const vein of pattern) {
    addBox(
      capAssembly,
      vein.name,
      boxGeometry,
      config.materials.capVein,
      [vein.center[0] * widthScale, y, vein.center[1] * depthScale],
      [vein.length * widthScale, veinHeight, vein.depth * depthScale],
      [0, vein.yaw, 0],
    );
  }
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLeafBuckets(count, random, settings) {
  const buckets = [[], [], []];
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const rootRadius = Math.sqrt(random()) * settings.rootSpread;
    const base = [Math.cos(angle) * rootRadius, Math.sin(angle) * rootRadius];
    const variant = random();
    const bucket = variant < settings.goldShare ? 0 : variant < settings.goldShare + settings.limeShare ? 1 : 2;
    buckets[bucket].push({
      angle: angle + (random() - 0.5) * 0.38,
      base,
      height: settings.height[0] + random() * (settings.height[1] - settings.height[0]),
      width: settings.width[0] + random() * (settings.width[1] - settings.width[0]),
      bend: settings.bend[0] + random() * (settings.bend[1] - settings.bend[0]),
      phase: random() * Math.PI * 2,
    });
  }
  return buckets;
}

function addSoilPatch(parent, name, geometry, position, radius) {
  parent.add(mesh(name, geometry, C.materials.soil, position, [radius, 1, radius]));
}

function addBladedPlantGroups(root, boxGeometry) {
  const planting = root.add(new SceneNode({ name: "PlantingGroups" }));
  const settings = C.plants;
  const density = Math.max(0, Math.min(2, settings.density));
  const soilGeometry = createDiscGeometry(1, 24);
  const bladeMaterials = [C.materials.leafGold, C.materials.leafLime, C.materials.leafGreen];

  settings.tallClusterPositions.forEach(([x, z], index) => {
    const group = planting.add(new SceneNode({ name: `StrapLeafClump${String(index + 1).padStart(2, "0")}`, position: [x, 0, z] }));
    addSoilPatch(group, "MulchAndSoilRootPatch", soilGeometry, [0, 0.004, 0], 0.49);
    const random = seededRandom(settings.seed + index * 104729);
    const buckets = makeLeafBuckets(Math.round(settings.tallLeavesPerCluster * density), random, {
      rootSpread: 0.31,
      height: [1.08, 1.95],
      width: [0.09, 0.17],
      bend: [0.28, 0.66],
      goldShare: 0.42,
      limeShare: 0.4,
    });
    buckets.forEach((leaves, colorIndex) => {
      if (leaves.length === 0) return;
      group.add(mesh(`WindLeafSet${colorIndex + 1}`, createLeafClusterGeometry(leaves), bladeMaterials[colorIndex]));
    });
  });

  const frontBedSoilThickness = 0.012;
  const frontBedSurfaceY = C.plaza.paverThickness + frontBedSoilThickness;
  const frontBed = planting.add(new SceneNode({
    name: "NearFrontPlantingBed",
    position: [0, frontBedSurfaceY, 0],
  }));
  frontBed.add(mesh(
    "NearFrontPlantingSoilBed",
    createAnnularSectorPrismGeometry(
      settings.frontBedSoilInnerRadius,
      settings.frontBedSoilOuterRadius,
      frontBedSoilThickness,
      settings.frontBedSoilStartAngle,
      settings.frontBedSoilEndAngle,
      40,
    ),
    C.materials.soil,
    [0, -frontBedSoilThickness / 2, 0],
  ));
  settings.frontBedClusters.forEach((cluster, index) => {
    const [x, z] = cluster.position;
    const group = frontBed.add(new SceneNode({
      name: `NearFrontLeafCluster${String(index + 1).padStart(2, "0")}`,
      position: [x, 0, z],
    }));
    const random = seededRandom(settings.seed + 1100003 + index * 27011);
    const buckets = makeLeafBuckets(Math.round(cluster.leaves * density), random, {
      rootSpread: cluster.rootSpread,
      height: cluster.height,
      width: [0.055, 0.105],
      bend: [0.18, 0.54],
      goldShare: 0.42,
      limeShare: 0.4,
    });
    buckets.forEach((leaves, colorIndex) => {
      if (leaves.length === 0) return;
      group.add(mesh(`WindLeafSet${colorIndex + 1}`, createLeafClusterGeometry(leaves), bladeMaterials[colorIndex]));
    });
  });

  settings.redTuftPositions.forEach(([x, z], index) => {
    const group = planting.add(new SceneNode({ name: `RussetTuft${String(index + 1).padStart(2, "0")}`, position: [x, 0, z] }));
    addSoilPatch(group, "BareSoilRootPatch", soilGeometry, [0, 0.004, 0], 0.37);
    const random = seededRandom(settings.seed + 700001 + index * 13007);
    const buckets = makeLeafBuckets(Math.round(settings.redLeavesPerTuft * density), random, {
      rootSpread: 0.16,
      height: [0.52, 0.88],
      width: [0.035, 0.068],
      bend: [0.09, 0.24],
      goldShare: 0.46,
      limeShare: 0.18,
    });
    if (buckets[0].length > 0) {
      group.add(mesh("ReddishNarrowLeaves", createLeafClusterGeometry(buckets[0]), C.materials.leafRustLight));
    }
    const darkerLeaves = buckets[1].concat(buckets[2]);
    if (darkerLeaves.length > 0) {
      group.add(mesh("DeepRustLeaves", createLeafClusterGeometry(darkerLeaves), C.materials.leafRust));
    }
  });

  const shrubGeometry = createSphereGeometry(12, 8);
  settings.shrubPositions.forEach(([x, z], index) => {
    const group = planting.add(new SceneNode({ name: `VariegatedLowShrub${String(index + 1).padStart(2, "0")}`, position: [x, 0, z] }));
    addSoilPatch(group, "ShrubSoilBed", soilGeometry, [0, 0.005, 0], 0.72);
    const random = seededRandom(settings.seed + 900001 + index * 16381);
    for (let lump = 0; lump < 8; lump += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 0.42;
      const pale = random() > 0.55;
      group.add(mesh(
        `ShrubLeafMass${lump + 1}`,
        shrubGeometry,
        pale ? C.materials.shrubVariegated : C.materials.shrub,
        [Math.cos(angle) * radius, 0.18 + random() * 0.14, Math.sin(angle) * radius],
        [0.44 + random() * 0.22, 0.28 + random() * 0.18, 0.38 + random() * 0.2],
      ));
    }
  });
  return planting;
}

function addBench(parent, boxGeometry, position, index) {
  const bench = parent.add(new SceneNode({ name: `WhiteParkBench${String(index + 1).padStart(2, "0")}`, position: [position[0], 0, position[1]] }));
  addBox(bench, "BenchSeat", boxGeometry, C.materials.bench, [0, 0.48, 0], [1.8, 0.09, 0.46], [0, 0, 0], { solid: true, surface: true });
  addBox(bench, "BenchBack", boxGeometry, C.materials.bench, [0, 0.82, -0.19], [1.8, 0.62, 0.08], [-7, 0, 0], { solid: true });
  for (const side of [-0.68, 0.68]) {
    addBox(bench, `BenchLeg${side < 0 ? "Left" : "Right"}`, boxGeometry, C.materials.metal, [side, 0.235, 0], [0.1, 0.46, 0.34], [0, 0, 0], { solid: true });
    addBox(bench, `BenchBackSupport${side < 0 ? "Left" : "Right"}`, boxGeometry, C.materials.metal, [side, 0.64, -0.12], [0.07, 0.8, 0.07], [-7, 0, 0], { solid: true });
  }
  return bench;
}

function addTree(parent, boxGeometry, sphereGeometry, settings, index) {
  const tree = parent.add(new SceneNode({ name: `ParkTree${String(index + 1).padStart(2, "0")}`, position: [settings.x, 0, settings.z] }));
  addBox(tree, "TreeTrunk", boxGeometry, C.materials.treeBark, [0, settings.height * 0.3, 0], [0.3, settings.height * 0.6, 0.3], [0, 0, 0], { solid: true });
  addBox(tree, "TreeBranchLeft", boxGeometry, C.materials.treeBark, [-settings.spread * 0.26, settings.height * 0.64, 0], [0.16, settings.height * 0.34, 0.16], [0, 0, -28]);
  addBox(tree, "TreeBranchRight", boxGeometry, C.materials.treeBark, [settings.spread * 0.24, settings.height * 0.72, 0.04], [0.15, settings.height * 0.3, 0.15], [0, 0, 25]);
  tree.add(mesh("TreeCanopyMain", sphereGeometry, C.materials.treeCanopy, [0, settings.height * 0.83, 0], [settings.spread * 2, settings.height * 0.66, settings.spread * 1.7]));
  tree.add(mesh("TreeCanopyLeft", sphereGeometry, C.materials.treeCanopyLight, [-settings.spread * 0.52, settings.height * 0.71, 0.12], [settings.spread * 1.3, settings.height * 0.46, settings.spread * 1.25]));
  tree.add(mesh("TreeCanopyRight", sphereGeometry, C.materials.treeCanopy, [settings.spread * 0.55, settings.height * 0.76, -0.1], [settings.spread * 1.4, settings.height * 0.5, settings.spread * 1.3]));
  return tree;
}

function addCampusContext(root, boxGeometry) {
  const settings = C.context;
  const campus = root.add(new SceneNode({ name: "CampusContext" }));
  const building = campus.add(new SceneNode({ name: "AsymmetricGlazedCampusBuilding" }));
  addBox(building, "MainBuildingMass", boxGeometry, C.materials.building, settings.buildingPosition, settings.buildingSize, [0, 0, 0], { solid: true });
  addBox(building, "BlueGlazedFacade", boxGeometry, C.materials.glazing, settings.glazingPosition, settings.glazingSize, [0, 0, 0], { solid: true });
  addBox(building, "EastBuildingWing", boxGeometry, C.materials.building, settings.buildingWingPosition, settings.buildingWingSize, [0, 0, 0], { solid: true });
  addBox(building, "RoofSlab", boxGeometry, C.materials.building, settings.buildingRoofPosition, settings.buildingRoofSize, [0, 0, 0], { solid: true });
  for (const x of [-10.9, -6.3, 0, 6.2, 10.8]) {
    addBox(building, `WhiteBuildingSupport${String(x).replace("-", "M")}`, boxGeometry, C.materials.building, [x, 2.76, -14.18], [0.32, 5.52, 0.4], [0, 0, 0], { solid: true });
  }
  for (let index = 0; index < settings.louverCount; index += 1) {
    const fraction = settings.louverCount === 1 ? 0.5 : index / (settings.louverCount - 1);
    const y = settings.louverStartY + (settings.louverEndY - settings.louverStartY) * fraction;
    addBox(building, `HorizontalSilverLouver${String(index + 1).padStart(2, "0")}`, boxGeometry, C.materials.metal, [0, y, -14.3], settings.louverSize, [0, 0, 0], { solid: true });
  }
  const sign = building.add(new SceneNode({ name: "BlueWayfindingSign", position: [9.35, 2.8, -14.2] }));
  addBox(sign, "SignPanel", boxGeometry, C.materials.campusSign, [0, 0, 0], [0.84, 2.2, 0.09], [0, 0, 0], { solid: true });
  addBox(sign, "SignTopLine", boxGeometry, C.materials.bench, [0, 0.65, 0.051], [0.52, 0.035, 0.008]);
  addBox(sign, "SignMiddleLine", boxGeometry, C.materials.bench, [0, 0.4, 0.051], [0.44, 0.025, 0.008]);
  addBox(sign, "SignLowerLine", boxGeometry, C.materials.bench, [0, 0.15, 0.051], [0.47, 0.025, 0.008]);

  for (let index = 0; index < settings.roadPositions.length; index += 1) {
  addBox(campus, index === 0 ? "BuildingAccessRoad" : "ParkRoad", boxGeometry, C.materials.road, settings.roadPositions[index], settings.roadSize, [0, 0, 0], { surface: true });
  }

  const sphereGeometry = createSphereGeometry(12, 8);
  settings.treePositions.forEach((tree, index) => addTree(campus, boxGeometry, sphereGeometry, tree, index));
  settings.benchPositions.forEach((position, index) => addBench(campus, boxGeometry, position, index));
  return campus;
}

export function createMonument(config = CONFIG) {
  const boxGeometry = createBoxGeometry();
  const layout = deriveMonumentLayout(config.monument);
  const monument = new SceneNode({ name: "Monument" });
  const plinth = monument.add(new SceneNode({ name: "SteppedPlinth" }));
  for (const step of config.monument.steps) {
    addBox(plinth, step.name, boxGeometry, config.materials.plinth, step.position, step.size, [0, 0, 0], { solid: true, surface: true });
  }

  const bodyAssembly = monument.add(new SceneNode({ name: "PlaqueBearingMainBodyAssembly", position: layout.mainBody.position }));
  addBox(bodyAssembly, "PlaqueBearingMainBody", boxGeometry, config.materials.stone, [0, 0, 0], config.monument.mainBody.size, [0, 0, 0], { solid: true, surface: true });
  addPlaque(bodyAssembly, boxGeometry, config);
  const rearMark = createExtrudedPolygonGeometry([[-0.035, -0.015], [0.035, -0.015], [0, 0.05]], 0.006);
  bodyAssembly.add(mesh("RearRedTriangle", rearMark, config.materials.rearMark, [0, -0.38, -0.386], [1, 1, 1], [0, 0, 180]));
  addBox(monument, "IvoryBand", boxGeometry, config.materials.band, layout.band.position, config.monument.band.size, [0, 0, 0], { solid: true, surface: true });

  const neckAssembly = monument.add(new SceneNode({ name: "GrayStoneNeckAssembly", position: layout.neck.position }));
  addBox(neckAssembly, "GrayStoneNeckBlock", boxGeometry, config.materials.stone, [0, 0, 0], config.monument.neck.size, [0, 0, 0], { solid: true, surface: true });

  const capAssembly = monument.add(new SceneNode({ name: "BlackCapAndEmblem", position: layout.cap.position }));
  addBox(capAssembly, "BlackPolishedCap", boxGeometry, config.materials.cap, [0, 0, 0], config.monument.cap.size, [0, 0, 0], { solid: true, surface: true });
  addCapVeins(capAssembly, boxGeometry, config);
  addEmblem(capAssembly, boxGeometry, config);

  return monument;
}

export function createScene() {
  const boxGeometry = createBoxGeometry();
  const root = new SceneNode({ name: "Site" });
  addPlaza(root, boxGeometry);
  addBladedPlantGroups(root, boxGeometry);
  addCampusContext(root, boxGeometry);
  root.add(createMonument());
  return root;
}
