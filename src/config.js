// All values use relative scene units; source photographs are not calibrated.
import { YELLOW_PETAL_CONTOURS, YELLOW_PETAL_HEIGHT, YELLOW_PETAL_WIDTH } from "./yellow-petal-contours.js";

export const CONFIG = {
  renderer: {
    maxPixelRatio: 2,
    verticalFovDegrees: 49,
    near: 0.08,
    far: 90,
    clearColor: [0.82, 0.86, 0.85, 1],
    horizonColor: [0.875, 0.895, 0.885],
  },
  camera: {
    eyeHeight: 1.58,
    crouchEyeHeight: 1.04,
    standingBodyHeight: 1.78,
    crouchBodyHeight: 1.22,
    startPosition: [0, 1.58, 7.2],
    startYaw: 0.055,
    startPitch: -0.18,
    pitchMinDegrees: -76,
    pitchMaxDegrees: 72,
    mouseRadiansPerPixel: 0.0022,
    lookFilter: {
      maxPixelsPerSecond: 20000,
      maxPixelsPerEvent: 4096,
      timestampTieFallbackMs: 8,
      // Bound the first sample as if it covered at most one 16 ms input window.
      firstEventWindowMs: 16,
    },
    walkingSpeed: 1.55,
    sprintMultiplier: 1.65,
    crouchMultiplier: 0.55,
    jumpVelocity: 3.8,
    gravity: 9.8,
    eyeSmoothingRate: 12,
    maxStepHeight: 0.29,
    maxStepDown: 0.34,
    simulationStep: 1 / 120,
    collisionSubstep: 0.06,
    collisionRadius: 0.24,
    collisionBoundsMargin: 0.01,
  },
  lighting: {
    direction: [-0.436, 0.712, 0.551],
    color: [0.98, 0.96, 0.9],
    ambientStrength: 0.39,
    diffuseStrength: 0.78,
    defaultSpecular: 0.12,
    shininess: 24,
  },
  sun: {
    angularDiameterDegrees: 1.5,
    color: [1, 0.98, 0.89],
    haloColor: [1, 0.83, 0.63],
    haloRadiusDegrees: 4.2,
    haloIntensity: 0.12,
    haloFalloff: 3.2,
  },
  textures: {
    stone: "./assets/textures/stone.png",
    capMarble: "./assets/textures/cap-marble.png",
    paving: "./assets/textures/paving.png",
    apronTile: "./assets/textures/apron-tile.png",
    curb: "./assets/textures/curb-stone.png",
    gravel: "./assets/textures/gravel.png",
    ground: "./assets/textures/grass-ground.png",
    plaquePhoto: "./assets/textures/plaque-photo.jpg",
  },
  materials: {
    earth: { color: [1, 1, 1], texture: "ground", textureRepeat: [0.7, 0.7], shininess: 4, specular: 0.015 },
    paving: { color: [1, 1, 1], texture: "paving", textureRepeat: [1.6, 1.6], shininess: 8, specular: 0.04 },
    gravel: { color: [1, 1, 1], texture: "gravel", textureRepeat: [0.75, 0.75], shininess: 3, specular: 0.02 },
    curb: { color: [1, 1, 1], texture: "curb", textureRepeat: [1.5, 1.5], shininess: 12, specular: 0.07 },
    tile: { color: [1, 1, 1], texture: "apronTile", textureRepeat: [1.7, 1.7], shininess: 8, specular: 0.035 },
    tileAccent: { color: [0.18, 0.19, 0.2], shininess: 7, specular: 0.015 },
    grout: { color: [0.085, 0.09, 0.085], shininess: 3, specular: 0.01 },
    plinth: { color: [1, 1, 1], texture: "stone", textureRepeat: [1.65, 1.65], shininess: 14, specular: 0.06 },
    stone: { color: [1, 1, 1], texture: "stone", textureRepeat: [1.9, 1.9], shininess: 12, specular: 0.05 },
    plaqueFrame: { color: [0.75, 0.74, 0.70], shininess: 18 },
    plaque: { color: [1, 1, 1], texture: "plaquePhoto", shininess: 12 },
    lettering: { color: [0.13, 0.16, 0.18], shininess: 3 },
    band: { color: [0.76, 0.73, 0.68], shininess: 16 },
    cap: { color: [1, 1, 1], texture: "capMarble", textureRepeat: [1.0, 1.0], shininess: 72, specular: 0.42 },
    capVein: { color: [0.2, 0.205, 0.2], shininess: 28 },
    emblemOutline: { color: [0.035, 0.045, 0.075], shininess: 28 },
    emblemNavy: { color: [0.06, 0.09, 0.28], shininess: 28 },
    emblemCyan: { color: [0.18, 0.4, 0.62], shininess: 24 },
    torch: { color: [0.38, 0.43, 0.5], shininess: 26 },
    torchHighlight: { color: [0.68, 0.72, 0.75], shininess: 24 },
    lotus: { color: [0.5, 0.48, 0.08], shininess: 20 },
    lotusHighlight: { color: [0.64, 0.58, 0.12], shininess: 20 },
    rearMark: { color: [0.58, 0.045, 0.035], shininess: 10 },
    leafGold: { color: [0.62, 0.56, 0.07], shininess: 10, specular: 0.035, doubleSided: true },
    leafLime: { color: [0.46, 0.54, 0.085], shininess: 10, specular: 0.035, doubleSided: true },
    leafGreen: { color: [0.17, 0.32, 0.09], shininess: 9, specular: 0.03, doubleSided: true },
    leafRust: { color: [0.32, 0.075, 0.025], shininess: 8, specular: 0.02, doubleSided: true },
    leafRustLight: { color: [0.48, 0.12, 0.035], shininess: 8, specular: 0.025, doubleSided: true },
    soil: { color: [0.11, 0.075, 0.035], shininess: 3, specular: 0.01 },
    shrub: { color: [0.12, 0.26, 0.1], shininess: 12, specular: 0.025 },
    shrubVariegated: { color: [0.4, 0.39, 0.2], shininess: 12, specular: 0.025 },
    treeBark: { color: [0.12, 0.065, 0.035], shininess: 5, specular: 0.01 },
    treeCanopy: { color: [0.035, 0.12, 0.045], shininess: 7, specular: 0.02 },
    treeCanopyLight: { color: [0.06, 0.19, 0.065], shininess: 8, specular: 0.02 },
    road: { color: [0.12, 0.13, 0.13], shininess: 5, specular: 0.015 },
    building: { color: [0.62, 0.66, 0.67], shininess: 16, specular: 0.08 },
    glazing: { color: [0.08, 0.27, 0.36], shininess: 32, specular: 0.28 },
    metal: { color: [0.48, 0.54, 0.56], shininess: 48, specular: 0.34 },
    campusSign: { color: [0.035, 0.16, 0.36], shininess: 24, specular: 0.13 },
    bench: { color: [0.65, 0.68, 0.64], shininess: 24, specular: 0.18 },
  },
  plaza: {
    groundSize: [60, 0.18, 60],
    paverInnerRadius: 3.07,
    paverOuterRadius: 5.8,
    paverThickness: 0.04,
    paverRows: 4,
    paverSectors: 32,
    paverJointWidth: 0.012,
    gravelRadius: 3.02,
    curbInnerRadius: 2.91,
    curbOuterRadius: 3.05,
    curbHeight: 0.12,
    tilePadSize: [2.68, 0.08, 2.68],
    tilePadY: 0.18,
    triangleSpan: 0.8,
    tileGroutCount: 5,
    tileGroutWidth: 0.014,
  },
  monument: {
    steps: [
      { name: "PlinthStepLower", size: [1.5, 0.18, 1.28], position: [0, 0.09, 0] },
      { name: "PlinthStepMiddle", size: [1.3, 0.16, 1.08], position: [0, 0.26, 0] },
      { name: "PlinthStepUpper", size: [1.09, 0.18, 0.9], position: [0, 0.43, 0] },
    ],
    mainBody: { size: [1.11, 1.04, 0.76] },
    band: { size: [1.11, 0.13, 0.8] },
    neck: { size: [0.62, 0.13, 0.7] },
    cap: { size: [0.87, 0.10, 0.80] },
    plaque: {
      frameSize: [0.78, 0.49, 0.05],
      panelSize: [0.72, 0.43, 0.018],
      position: [0, 0.06, 0.402],
    },
    emblem: {
      clearanceAboveCapTop: 0.055,
      ringCenterY: 0.48,
      ringOuterRadius: 0.465,
      ringOutlineOuterRadius: 0.49,
      ringInnerRadius: 0.37,
      ringOutlineInnerWidth: 0.008,
      toothRadius: 0.51,
      ringDepth: 0.11,
      toothCount: 8,
      faceOffset: 0.056,
      torchStemBaseY: 0.20,
      torchStemTopY: 0.87,
      torchStemWidth: 0.08,
      torchHeadBottomY: 0.87,
      torchHeadWidth: 0.09,
      torchTopY: 0.94,
      torchBaseBottomY: 0.06,
      torchBaseTopY: 0.19,
      torchBaseOutlineWidth: 0.004,
      torchBasePetalDepth: 0.008,
      torchBaseOutlineZOffset: 0.004,
      torchBaseFillZOffset: 0.012,
      torchBaseDividerZ: 0.08,
      torchBaseContours: {
        outerWing: {
          start: [0, 0],
          segments: [
            { control1: [-0.14, -0.06], control2: [-0.64, -0.2], end: [-1, -0.58] },
            { control1: [-0.93, -0.84], control2: [-0.72, -1], end: [-0.22, -1] },
            { control1: [-0.06, -0.96], control2: [-0.04, -0.3], end: [0, 0] },
          ],
        },
        innerFold: {
          start: [-0.29, 0],
          segments: [
            { control1: [-0.19295, -0.03576], control2: [-0.09635, -0.07236], end: [0, -0.11] },
            { control1: [0, -0.4067], control2: [0, -0.7033], end: [0, -1] },
            { control1: [-0.2467, -1.001], control2: [-0.4933, -1.001], end: [-0.74, -1] },
            { control1: [-0.8276, -0.8505], control2: [-0.9142, -0.7005], end: [-1, -0.55] },
            { control1: [-0.8505, -0.4691], control2: [-0.7005, -0.3891], end: [-0.55, -0.31] },
            { control1: [-0.4641, -0.2061], control2: [-0.3775, -0.1027], end: [-0.29, 0] },
          ],
        },
      },
      torchBasePanels: [
        { name: "OuterLeft", contour: "outerWing", mirrorX: 1, position: [0, 0.19, 0.048], width: 0.2, height: 0.14 },
        { name: "OuterRight", contour: "outerWing", mirrorX: -1, position: [0, 0.19, 0.05], width: 0.2, height: 0.14 },
        { name: "InnerLeft", contour: "innerFold", mirrorX: 1, position: [0, 0.19, 0.058], width: 0.095, height: 0.14 },
        { name: "InnerRight", contour: "innerFold", mirrorX: -1, position: [0, 0.19, 0.06], width: 0.095, height: 0.14 },
      ],
      torchFluteOffset: 0.016,
      torchFluteWidth: 0.006,
      torchBaseDividerWidth: 0.006,
      flowerBaseY: 0.19,
      flowerOutlineWidth: 0.005,
      flowerPetalDepth: 0.008,
      // Five threshold-traced visible regions share the source-image frame and aspect ratio.
      flowerContourProfiles: YELLOW_PETAL_CONTOURS,
      flowerPetals: [
        { name: "Center", contour: "center", mirrorX: 1, position: [0, 0.19, 0.072], width: YELLOW_PETAL_WIDTH, height: YELLOW_PETAL_HEIGHT },
        { name: "InnerLeft", contour: "innerLeft", mirrorX: 1, position: [0, 0.19, 0.06], width: YELLOW_PETAL_WIDTH, height: YELLOW_PETAL_HEIGHT },
        { name: "InnerRight", contour: "innerRight", mirrorX: 1, position: [0, 0.19, 0.061], width: YELLOW_PETAL_WIDTH, height: YELLOW_PETAL_HEIGHT },
        { name: "OuterLeft", contour: "outerLeft", mirrorX: 1, position: [0, 0.19, 0.048], width: YELLOW_PETAL_WIDTH, height: YELLOW_PETAL_HEIGHT },
        { name: "OuterRight", contour: "outerRight", mirrorX: 1, position: [0, 0.19, 0.05], width: YELLOW_PETAL_WIDTH, height: YELLOW_PETAL_HEIGHT },
      ],
    },
  },
  wind: {
    direction: [0, -1],
    amplitude: 0.16,
    speed: 1.65,
  },
  plants: {
    seed: 20261103,
    density: 1.2,
    tallLeavesPerCluster: 36,
    frontBedSoilInnerRadius: 4.5,
    frontBedSoilOuterRadius: 5.25,
    frontBedSoilStartAngle: -0.48,
    frontBedSoilEndAngle: 0.48,
    tallClusterPositions: [
      [-5.5, -3.8], [-6.2, 0.1], [-5.4, 3.9], [-3.7, 5.8], [3.9, 5.9],
      [5.9, 3.8], [6.4, 0.4], [5.4, -3.5], [3.7, -5.9], [-3.8, -5.8],
    ],
    frontBedClusters: [
      { position: [-1.8, 4.55], leaves: 24, rootSpread: 0.18, height: [0.18, 0.38] },
      { position: [-1.05, 4.9], leaves: 30, rootSpread: 0.22, height: [0.2, 0.42] },
      { position: [-0.18, 5.05], leaves: 22, rootSpread: 0.17, height: [0.16, 0.34] },
      { position: [1.0, 4.82], leaves: 28, rootSpread: 0.22, height: [0.22, 0.44] },
      { position: [1.85, 4.48], leaves: 24, rootSpread: 0.16, height: [0.18, 0.38] },
    ],
    redLeavesPerTuft: 16,
    redTuftPositions: [
      [-7.2, -5.4], [-7.4, 4.9], [7.1, -5.7], [7.5, 4.7], [-2.3, 7.6], [2.4, 7.7],
    ],
    shrubPositions: [[-8.3, -9.8], [-2.2, -10.5], [5.8, -10.1], [-8.6, 8.6], [8.7, 9.1]],
  },
  context: {
    buildingPosition: [0, 3.5, -15],
    buildingSize: [26, 7, 1],
    buildingWingPosition: [11.4, 2.55, -15.95],
    buildingWingSize: [8.6, 5.1, 1.5],
    buildingRoofPosition: [0, 6.96, -14.95],
    buildingRoofSize: [26.6, 0.18, 1.18],
    glazingPosition: [0, 4.05, -14.43],
    glazingSize: [22, 4.65, 0.08],
    louverStartY: 2.05,
    louverEndY: 6.05,
    louverCount: 19,
    louverSize: [22.2, 0.035, 0.13],
    roadPositions: [[0, 0.005, -8.1], [0, 0.005, 10.8]],
    roadSize: [34, 0.04, 2.5],
    treePositions: [
      { x: -12.5, z: 14.0, height: 5.4, spread: 2.5 },
      { x: -8.6, z: 18.0, height: 6.2, spread: 2.8 },
      { x: -2.8, z: 15.8, height: 5.0, spread: 2.4 },
      { x: 5.2, z: 18.2, height: 6.4, spread: 3.0 },
      { x: 12.1, z: 14.5, height: 5.3, spread: 2.5 },
    ],
    benchPositions: [[-4.4, 12.7], [4.9, 13.2]],
  },
};

// Derive the monument stack and footprint from editable sizes so dependent parts stay aligned.
export function deriveMonumentLayout(monument = CONFIG.monument, collisionMargin = 0) {
  const plinthTopY = Math.max(...monument.steps.map((step) => step.position[1] + step.size[1] / 2));
  const bodyBottomY = plinthTopY;
  const bodyTopY = bodyBottomY + monument.mainBody.size[1];
  const bandBottomY = bodyTopY;
  const bandTopY = bandBottomY + monument.band.size[1];
  const neckBottomY = bandTopY;
  const neckTopY = neckBottomY + monument.neck.size[1];
  const capBottomY = neckTopY;
  const capTopY = capBottomY + monument.cap.size[1];
  const capLocalEmblemY = monument.cap.size[1] / 2 + monument.emblem.clearanceAboveCapTop;

  const horizontalParts = [
    ...monument.steps.map(({ size, position }) => ({
      minX: position[0] - size[0] / 2,
      maxX: position[0] + size[0] / 2,
      minZ: position[2] - size[2] / 2,
      maxZ: position[2] + size[2] / 2,
    })),
    ...[monument.mainBody, monument.band, monument.neck, monument.cap].map(({ size }) => ({
      minX: -size[0] / 2,
      maxX: size[0] / 2,
      minZ: -size[2] / 2,
      maxZ: size[2] / 2,
    })),
  ];

  const plaque = monument.plaque;
  const plaqueHalfWidth = Math.max(plaque.frameSize[0], plaque.panelSize[0]) / 2;
  const plaqueFront = plaque.position[2] + Math.max(
    0.018 + plaque.frameSize[2] / 2,
    0.052 + plaque.panelSize[2] / 2,
  );
  horizontalParts.push({
    minX: plaque.position[0] - plaqueHalfWidth,
    maxX: plaque.position[0] + plaqueHalfWidth,
    minZ: plaque.position[2] - Math.max(plaque.frameSize[2] / 2, plaque.panelSize[2] / 2),
    maxZ: plaqueFront,
  });

  const emblemHalfWidth = monument.emblem.toothRadius + 0.025;
  const emblemHalfDepth = monument.emblem.faceOffset + Math.max(monument.emblem.ringDepth / 2, 0.015);
  horizontalParts.push({ minX: -emblemHalfWidth, maxX: emblemHalfWidth, minZ: -emblemHalfDepth, maxZ: emblemHalfDepth });

  const collisionBounds = horizontalParts.reduce((bounds, part) => ({
    minX: Math.min(bounds.minX, part.minX),
    maxX: Math.max(bounds.maxX, part.maxX),
    minZ: Math.min(bounds.minZ, part.minZ),
    maxZ: Math.max(bounds.maxZ, part.maxZ),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

  return {
    plinthTopY,
    mainBody: { bottomY: bodyBottomY, topY: bodyTopY, position: [0, (bodyBottomY + bodyTopY) / 2, 0] },
    band: { bottomY: bandBottomY, topY: bandTopY, position: [0, (bandBottomY + bandTopY) / 2, 0] },
    neck: { bottomY: neckBottomY, topY: neckTopY, position: [0, (neckBottomY + neckTopY) / 2, 0] },
    cap: { bottomY: capBottomY, topY: capTopY, position: [0, (capBottomY + capTopY) / 2, 0] },
    emblem: {
      worldPosition: [0, capTopY + monument.emblem.clearanceAboveCapTop, 0],
      capLocalPosition: [0, capLocalEmblemY, 0],
    },
    collisionBounds: {
      minX: collisionBounds.minX - collisionMargin,
      maxX: collisionBounds.maxX + collisionMargin,
      minZ: collisionBounds.minZ - collisionMargin,
      maxZ: collisionBounds.maxZ + collisionMargin,
    },
  };
}

export const CAMERA_PRESETS = {
  front: { position: [...CONFIG.camera.startPosition], yaw: CONFIG.camera.startYaw, pitch: CONFIG.camera.startPitch },
  threeQuarter: {
    position: [4.0, CONFIG.camera.eyeHeight, 3.0],
    yaw: -0.927,
    pitch: 0,
  },
  profile: {
    position: [5.0, CONFIG.camera.eyeHeight, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
  },
  rear: {
    position: [0, CONFIG.camera.eyeHeight, -6.2],
    yaw: Math.PI,
    pitch: 0,
  },
};
