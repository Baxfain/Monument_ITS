import { CONFIG, deriveMonumentLayout } from "./config.js";
import {
  createBoxGeometry,
  createApronGridGeometry,
  createCircleContour,
  createDiscGeometry,
  createExtrudedPolygonFieldGeometry,
  createExtrudedContourGeometry,
  createExtrudedPolygonGeometry,
  createLeafClusterGeometry,
  createOutlinedEmblemPetal,
  createPolygonFieldGeometry,
  createRampSurfaceGeometry,
  createRingPrismGeometry,
  createSphereGeometry,
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

function mergeGeometries(geometries) {
  const totalVertices = geometries.reduce((sum, geometry) => sum + geometry.vertexCount, 0);
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const windWeights = new Float32Array(totalVertices);
  const windPhases = new Float32Array(totalVertices);
  let vertexOffset = 0;
  for (const geometry of geometries) {
    positions.set(geometry.positions, vertexOffset * 3);
    normals.set(geometry.normals, vertexOffset * 3);
    uvs.set(geometry.uvs, vertexOffset * 2);
    windWeights.set(geometry.windWeights, vertexOffset);
    windPhases.set(geometry.windPhases, vertexOffset);
    vertexOffset += geometry.vertexCount;
  }
  return { positions, normals, uvs, windWeights, windPhases, vertexCount: totalVertices };
}

function offsetGeometryUvs(geometry, offsetX, offsetY) {
  for (let index = 0; index < geometry.uvs.length; index += 2) {
    geometry.uvs[index] += offsetX;
    geometry.uvs[index + 1] += offsetY;
  }
  return geometry;
}

function rectangleContour(minX, minZ, maxX, maxZ) {
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
}

function gridJointContours(outline, baseHoles, pitch, width, fixedCoordinates = null) {
  const minX = Math.min(...outline.map(([x]) => x));
  const maxX = Math.max(...outline.map(([x]) => x));
  const minZ = Math.min(...outline.map(([, z]) => z));
  const maxZ = Math.max(...outline.map(([, z]) => z));
  const margin = Math.max(maxX - minX, maxZ - minZ) + pitch;
  const coordinatesBetween = (min, max) => fixedCoordinates
    ? fixedCoordinates.filter((coordinate) => coordinate > min && coordinate < max)
    : Array.from(
      { length: Math.max(0, Math.ceil(max / pitch) - Math.ceil(min / pitch)) },
      (_, index) => (Math.ceil(min / pitch) + index) * pitch,
    );
  const horizontal = [];
  const vertical = [];
  for (const z of coordinatesBetween(minZ, maxZ)) {
    horizontal.push({
      contour: rectangleContour(minX - margin, z - width / 2, maxX + margin, z + width / 2),
      geometry: createPolygonFieldGeometry(outline, baseHoles, { range: [z - width / 2, z + width / 2] }),
    });
  }
  for (const x of coordinatesBetween(minX, maxX)) {
    vertical.push({
      contour: rectangleContour(x - width / 2, minZ - margin, x + width / 2, maxZ + margin),
      geometry: createPolygonFieldGeometry(outline, [...baseHoles, ...horizontal.map((item) => item.contour)], {
        axis: "x",
        range: [x - width / 2, x + width / 2],
      }),
    });
  }
  return {
    contours: [...horizontal, ...vertical].map((item) => item.contour),
    geometry: mergeGeometries([...horizontal, ...vertical].map((item) => item.geometry)),
  };
}

function addOuterPaving(plaza, boxGeometry) {
  const settings = C.plaza;
  const thickness = settings.paverThickness;
  const pavingPositionY = settings.paverTopY - thickness / 2;
  const rowWidth = (settings.paverOuterRadius - settings.paverInnerRadius) / settings.paverRows;
  const innerPaverContour = createCircleContour(settings.paverInnerRadius, 128);
  const outerPaverContour = createCircleContour(settings.paverOuterRadius, 128);
  const openings = [
    ...C.plants.plantingPockets.map((pocket) => pocket.contour),
    settings.lawnFootprint,
  ];

  for (let row = 0; row < settings.paverRows; row += 1) {
    const boundaryInner = settings.paverInnerRadius + rowWidth * row;
    const boundaryOuter = settings.paverInnerRadius + rowWidth * (row + 1);
    const inner = row === 0 ? boundaryInner : boundaryInner + settings.paverJointWidth / 2;
    const outer = row === settings.paverRows - 1 ? boundaryOuter : boundaryOuter - settings.paverJointWidth / 2;
    const radialContours = [];
    const offset = row % 2 === 0 ? 0.5 : 0;

    for (let index = 0; index < settings.paverSectors; index += 1) {
      const angle = ((index + offset) / settings.paverSectors) * Math.PI * 2;
      const innerHalfAngle = Math.asin(Math.min(1, settings.paverJointWidth / (2 * inner)));
      const outerHalfAngle = Math.asin(Math.min(1, settings.paverJointWidth / (2 * outer)));
      const polarPoint = (radius, bearing) => [Math.cos(bearing) * radius, Math.sin(bearing) * radius];
      const contour = [
        polarPoint(inner, angle - innerHalfAngle),
        polarPoint(outer, angle - outerHalfAngle),
        polarPoint(outer, angle + outerHalfAngle),
        polarPoint(inner, angle + innerHalfAngle),
      ];
      radialContours.push(contour);
      const radialJoint = createExtrudedPolygonFieldGeometry(contour, openings, thickness);
      plaza.add(mesh(
        `PaverRadialJoint${row}_${String(index + 1).padStart(2, "0")}`,
        radialJoint,
        C.materials.grout,
        [0, pavingPositionY, 0],
        [1, 1, 1],
        [0, 0, 0],
        { surface: true },
      ));
    }

    const rowOuterContour = createCircleContour(outer, 128);
    const rowInnerContour = createCircleContour(inner, 128);
    const rowTiles = createExtrudedPolygonFieldGeometry(
      rowOuterContour,
      [rowInnerContour, ...openings, ...radialContours],
      thickness,
    );
    plaza.add(mesh(
      `PaverAnnulusTiles${row + 1}`,
      rowTiles,
      C.materials.paving,
      [0, pavingPositionY, 0],
      [1, 1, 1],
      [0, 0, 0],
      { surface: true },
    ));

    if (row < settings.paverRows - 1) {
      const jointRadius = boundaryOuter;
      const arcJoint = createExtrudedPolygonFieldGeometry(
        createCircleContour(jointRadius + settings.paverJointWidth / 2, 128),
        [
          createCircleContour(jointRadius - settings.paverJointWidth / 2, 128),
          ...openings,
        ],
        thickness,
      );
      plaza.add(mesh(
        `PaverArcJoint${row + 1}`,
        arcJoint,
        C.materials.grout,
        [0, pavingPositionY, 0],
        [1, 1, 1],
        [0, 0, 0],
        { surface: true },
      ));
    }
  }

  const outerHoles = [
    outerPaverContour,
    innerPaverContour,
    ...C.plants.plantingPockets.map((pocket) => pocket.contour),
    settings.lawnFootprint,
  ];
  const joints = gridJointContours(settings.outerPavingOutline, outerHoles, settings.outerPavingTilePitch, settings.outerPavingJointWidth);
  const tiles = createExtrudedPolygonFieldGeometry(settings.outerPavingOutline, [...outerHoles, ...joints.contours], thickness);
  plaza.add(mesh("OuterPavingFieldTiles", tiles, C.materials.paving, [0, pavingPositionY, 0], [1, 1, 1], [0, 0, 0], { surface: true }));
  plaza.add(mesh("OuterPavingFieldGrout", joints.geometry, C.materials.grout, [0, settings.paverTopY, 0], [1, 1, 1], [0, 0, 0], { surface: true }));
}

function addSegmentedOuterCurb(plaza, boxGeometry) {
  const settings = C.plaza;
  const curb = settings.outerRoadsideCurb;
  const points = settings.outerPavingOutline;
  const signedArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
  const outwardSign = signedArea > 0 ? -1 : 1;

  for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
    if (curb.openingEdgeIndices.includes(edgeIndex)) continue;
    const from = points[edgeIndex];
    const to = points[(edgeIndex + 1) % points.length];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    const outward = [-dz / length * outwardSign, dx / length * outwardSign];
    const count = Math.max(1, Math.floor((length + curb.segmentGap) / (curb.segmentLength + curb.segmentGap)));
    const segmentLength = (length - curb.segmentGap * (count - 1)) / count;
    const spacing = segmentLength + curb.segmentGap;
    for (let index = 0; index < count; index += 1) {
      const along = index * spacing + segmentLength / 2;
      const x = from[0] + (dx / length) * along + outward[0] * curb.width / 2;
      const z = from[1] + (dz / length) * along + outward[1] * curb.width / 2;
      const yaw = -Math.atan2(dz, dx) * 180 / Math.PI;
      addBox(
        plaza,
        `OuterRoadsideCurb${String(edgeIndex + 1).padStart(2, "0")}_${String(index + 1).padStart(2, "0")}`,
        boxGeometry,
        C.materials.outerCurb,
        [x, curb.baseY + curb.height / 2, z],
        [segmentLength, curb.height, curb.width],
        [0, yaw, 0],
        { solid: true, surface: true },
      );
    }
  }
}

function addRoadBlocks(plaza) {
  const settings = C.plaza;
  const roadway = settings.roadway;
  for (const segment of roadway.segments) {
    const [width, depth] = segment.size;
    const columns = Math.max(1, Math.round(width / roadway.blockSize[0]));
    const rows = Math.max(1, Math.round(depth / roadway.blockSize[1]));
    const grid = createApronGridGeometry([width, 1, depth], columns - 1, roadway.jointWidth, rows - 1);
    const position = [segment.position[0], settings.entrance.roadTopY, segment.position[1]];
    const scale = [width, 1, depth];
    plaza.add(mesh(`${segment.name}JointSurface`, grid.grout, C.materials.roadJoint, position, scale, [0, 0, 0], { surface: true }));
    plaza.add(mesh(`${segment.name}`, grid.tiles, C.materials.road, position, scale, [0, 0, 0], { surface: true }));
  }
}

function addEntranceTransition(plaza, boxGeometry) {
  const settings = C.plaza;
  const entrance = settings.entrance;
  const highY = settings.paverTopY;
  const thresholdDrop = highY - entrance.roadTopY;
  addBox(
    plaza,
    "EntranceThresholdLip",
    boxGeometry,
    C.materials.curb,
    [0, highY - thresholdDrop / 2, entrance.thresholdCenterZ],
    [entrance.pathWidth, thresholdDrop, entrance.thresholdDepth],
    [0, 0, 0],
    { solid: true, surface: true },
  );
  const rampDepth = entrance.rampEndZ - entrance.rampStartZ;
  plaza.add(mesh(
    "EntranceAccessRamp",
    createRampSurfaceGeometry(entrance.pathWidth, rampDepth, entrance.roadTopY, highY),
    C.materials.paving,
    [0, 0, (entrance.rampStartZ + entrance.rampEndZ) / 2],
    [1, 1, 1],
    [0, 0, 0],
    { surface: true },
  ));
}

function addPlaza(root, boxGeometry) {
  const plaza = root.add(new SceneNode({ name: "Plaza" }));
  const groundPositionY = C.plaza.groundTopY - C.plaza.groundSize[1] / 2;
  addBox(plaza, "GroundPlane", boxGeometry, C.materials.earth, [0, groundPositionY, 0], C.plaza.groundSize, [0, 0, 0], { surface: true, perimeter: true });
  addOuterPaving(plaza, boxGeometry);
  addSegmentedOuterCurb(plaza, boxGeometry);
  addRoadBlocks(plaza);
  addEntranceTransition(plaza, boxGeometry);

  const gravel = createDiscGeometry(C.plaza.gravelRadius, 72);
  plaza.add(mesh("CircularGravelBed", gravel, C.materials.gravel, [0, 0.055, 0], [1, 1, 1], [0, 0, 0], { surface: true }));

  plaza.add(mesh(
    "RearRightPatchyLawn",
    createExtrudedPolygonFieldGeometry(
      C.plaza.lawnFootprint,
      [],
      C.plaza.islandLawnTopY - C.plaza.groundTopY,
    ),
    C.materials.lawn,
    [0, (C.plaza.islandLawnTopY + C.plaza.groundTopY) / 2, 0],
    [1, 1, 1],
    [0, 0, 0],
    { surface: true },
  ));

  const curb = createRingPrismGeometry(C.plaza.curbInnerRadius, C.plaza.curbOuterRadius, C.plaza.curbHeight, 72);
  plaza.add(mesh("RaisedCircularCurb", curb, C.materials.curb, [0, 0.105, 0], [1, 1, 1], [0, 0, 0], { solid: true, surface: true, shape: "annulus" }));

  const tilePadSize = C.plaza.tilePadSize;
  const tileTopY = C.plaza.tilePadY + tilePadSize[1] / 2;
  const apronContour = createCircleContour(C.plaza.tilePadRadius, 128);
  const apronTopOffset = 0.0001; // Keep the backing below tile/grout tops to avoid z-fighting.
  const apronBodyHeight = tilePadSize[1] - apronTopOffset;
  const apron = offsetGeometryUvs(
    createExtrudedPolygonFieldGeometry(apronContour, [], apronBodyHeight),
    tilePadSize[0] / 2,
    tilePadSize[2] / 2,
  );
  plaza.add(mesh(
    "CircularPavingApron",
    apron,
    C.materials.tile,
    [0, C.plaza.tilePadY - apronTopOffset / 2, 0],
    [1, 1, 1],
    [0, 0, 0],
  ));

  const gridPitch = tilePadSize[0] / (C.plaza.tileGroutCount + 1);
  const gridCoordinates = Array.from(
    { length: C.plaza.tileGroutCount },
    (_, index) => -tilePadSize[0] / 2 + (index + 1) * gridPitch,
  );
  const apronGrid = gridJointContours(
    apronContour,
    [],
    gridPitch,
    C.plaza.tileGroutWidth,
    gridCoordinates,
  );
  const apronTiles = offsetGeometryUvs(
    createPolygonFieldGeometry(apronContour, apronGrid.contours),
    tilePadSize[0] / 2,
    tilePadSize[2] / 2,
  );
  const surfaceY = tileTopY;
  plaza.add(mesh("ApronGroutSurface", apronGrid.geometry, C.materials.grout, [0, surfaceY, 0], [1, 1, 1], [0, 0, 0], { surface: true }));
  plaza.add(mesh("ApronTileSurfaces", apronTiles, C.materials.tile, [0, surfaceY, 0], [1, 1, 1], [0, 0, 0], { surface: true }));
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

function addBladedPlantGroups(root) {
  const planting = root.add(new SceneNode({ name: "PlantingGroups" }));
  const settings = C.plants;
  const density = Math.max(0, Math.min(2, settings.density));
  const bladeMaterials = [C.materials.leafGold, C.materials.leafLime, C.materials.leafGreen];

  settings.plantingPockets.forEach((pocket, pocketIndex) => {
    const bed = planting.add(new SceneNode({ name: pocket.name }));
    const soilDepth = settings.soilSurfaceY - C.plaza.groundTopY;
    bed.add(mesh(
      `${pocket.name}SoilSurface`,
      createExtrudedPolygonFieldGeometry(pocket.contour, [], soilDepth),
      C.materials.soil,
      [0, settings.soilSurfaceY - soilDepth / 2, 0],
      [1, 1, 1],
      [0, 0, 0],
      { surface: true },
    ));
    pocket.clusters.forEach((cluster, clusterIndex) => {
      const [x, z] = cluster.position;
      const group = bed.add(new SceneNode({
        name: `LeafCluster${String(clusterIndex + 1).padStart(2, "0")}`,
        position: [x, settings.soilSurfaceY, z],
      }));
      const random = seededRandom(settings.seed + pocketIndex * 104729 + clusterIndex * 27011);
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
  });

  settings.redTuftPositions.forEach(([x, z], index) => {
    const group = planting.add(new SceneNode({
      name: `RussetTuft${String(index + 1).padStart(2, "0")}`,
      position: [x, C.plaza.islandLawnTopY, z],
    }));
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
    const group = planting.add(new SceneNode({
      name: `VariegatedLowShrub${String(index + 1).padStart(2, "0")}`,
      position: [x, settings.soilSurfaceY, z],
    }));
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
  if (settings.buildingVisible) {
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
  addBladedPlantGroups(root);
  addCampusContext(root, boxGeometry);
  root.add(createMonument());
  return root;
}
