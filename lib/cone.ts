export type WindData = {
  wind_speed_mps: number;
  wind_dir_from_deg: number; // meteorological FROM direction
  time?: string | null;
  model?: string;
};

export function mpsToMph(mps: number) {
  return mps * 2.236936;
}

export function defaultHalfAngleDegFromMph(mph: number) {
  if (mph < 3) return 45;
  if (mph < 10) return 25;
  if (mph < 20) return 18;
  return 12;
}

export function bearingToCanvasRad(bearingDeg: number) {
  return ((bearingDeg - 90) * Math.PI) / 180;
}

export function downwindBearingDeg(fromDeg: number) {
  return (fromDeg + 180) % 360;
}

export type ConeGeometry = {
  tip: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
  centerRad: number;
  downwindDeg: number;
};

export function computeCone(
  src: { x: number; y: number },
  lengthPx: number,
  halfAngleDeg: number,
  windFromDeg: number
): ConeGeometry {
  const downwindDeg = downwindBearingDeg(windFromDeg);
  const theta = bearingToCanvasRad(downwindDeg);
  const half = (halfAngleDeg * Math.PI) / 180;

  const tip = { x: src.x + Math.cos(theta) * lengthPx, y: src.y + Math.sin(theta) * lengthPx };
  const leftTheta = theta - half;
  const rightTheta = theta + half;

  const left = { x: src.x + Math.cos(leftTheta) * lengthPx, y: src.y + Math.sin(leftTheta) * lengthPx };
  const right = { x: src.x + Math.cos(rightTheta) * lengthPx, y: src.y + Math.sin(rightTheta) * lengthPx };

  return { tip, left, right, centerRad: theta, downwindDeg };
}

