const DEFAULT_PRECISION = 2;

function formatCoordinate(value, precision) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(precision));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(precision);
}

export function formatCameraPosition(position, precision = DEFAULT_PRECISION) {
  return `X ${formatCoordinate(position[0], precision)} · Y ${formatCoordinate(position[1], precision)} · Z ${formatCoordinate(position[2], precision)}`;
}

export class CameraPositionHud {
  constructor(element, precision = DEFAULT_PRECISION) {
    if (!element) throw new Error("Camera position HUD requires an output element.");
    this.element = element;
    this.precision = precision;
    this.lastText = "";
  }

  update(position) {
    const nextText = formatCameraPosition(position, this.precision);
    if (nextText === this.lastText) return;
    this.element.textContent = nextText;
    this.lastText = nextText;
  }
}
