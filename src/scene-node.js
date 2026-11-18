import { Mat4, composeTransform } from "./math3d.js";
import { prepareObjectSpaceGeometry } from "./geometry-space.js";

export class SceneNode {
  constructor({
    name,
    geometry = null,
    material = null,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    visible = true,
    collision = null,
  }) {
    this.name = name;
    this.geometry = geometry;
    this.material = material;
    this.position = [...position];
    this.rotation = [...rotation];
    this.scale = [...scale];
    this.visible = visible;
    this.collision = collision ? { ...collision } : null;
    this.children = [];
  }

  add(child) {
    this.children.push(child);
    return child;
  }

  get geometry() {
    return this._geometry;
  }

  set geometry(source) {
    const prepared = prepareObjectSpaceGeometry(source);
    this._geometry = prepared.geometry;
    this.objectToConstruction = prepared.objectToConstruction;
  }

  localMatrix() {
    return composeTransform(this.position, this.rotation, this.scale);
  }

  localGeometryMatrix() {
    return Mat4.multiply(this.localMatrix(), this.objectToConstruction);
  }

  worldMatrix(parentWorld) {
    return Mat4.multiply(parentWorld, this.localMatrix());
  }

  worldGeometryMatrix(parentWorld) {
    return Mat4.multiply(parentWorld, this.localGeometryMatrix());
  }
}
