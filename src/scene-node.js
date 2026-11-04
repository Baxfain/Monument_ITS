import { composeTransform } from "./math3d.js";

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

  localMatrix() {
    return composeTransform(this.position, this.rotation, this.scale);
  }
}
