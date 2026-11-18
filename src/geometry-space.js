import { Mat4 } from "./math3d.js";

const preparedGeometryCache = new WeakMap();

export function prepareObjectSpaceGeometry(source) {
  if (source === null || source === undefined) {
    return {
      geometry: null,
      objectToConstruction: Mat4.identity(),
      center: [0, 0, 0],
      radius: 1,
    };
  }
  if (typeof source !== "object" || ArrayBuffer.isView(source)) {
    throw new TypeError("SceneNode geometry must be an object with a positions array.");
  }

  const cached = preparedGeometryCache.get(source);
  if (cached) return cached;

  const positions = source.positions;
  if (!positions || typeof positions.length !== "number" || positions.length % 3 !== 0) {
    throw new TypeError("SceneNode geometry positions must contain complete XYZ triples.");
  }
  const vertexCount = positions.length / 3;
  if (source.vertexCount !== undefined && source.vertexCount !== vertexCount) {
    throw new RangeError("SceneNode geometry vertexCount must match its positions array.");
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      if (!Number.isFinite(value)) {
        throw new RangeError("SceneNode geometry positions must all be finite.");
      }
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  const center = vertexCount === 0
    ? [0, 0, 0]
    : min.map((value, axis) => (value + max[axis]) / 2);
  const radius = vertexCount === 0
    ? 1
    : Math.max(...min.map((value, axis) => (max[axis] - value) / 2)) || 1;
  const normalizedPositions = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const normalized = (positions[index + axis] - center[axis]) / radius;
      normalizedPositions[index + axis] = Math.max(-1, Math.min(1, normalized));
    }
  }

  const geometry = {
    ...source,
    positions: normalizedPositions,
    vertexCount,
  };
  const objectToConstruction = Mat4.multiply(
    Mat4.translation(center[0], center[1], center[2]),
    Mat4.scaling(radius, radius, radius),
  );
  const prepared = { geometry, objectToConstruction, center: [...center], radius };
  preparedGeometryCache.set(source, prepared);
  preparedGeometryCache.set(geometry, prepared);
  return prepared;
}
