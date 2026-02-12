import {
  ConeDistanceBand,
  ConeSettings,
  LatLng,
  PointSample,
  Stability,
  TrackMetrics,
} from "@/lib/types";

const EARTH_RADIUS_M = 6371000;

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function windFromToDeg(windFromDeg: number): number {
  return normalizeDeg(windFromDeg + 180);
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const br = toRad(bearingDeg);
  const d = distanceM / EARTH_RADIUS_M;
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: toDeg(lon2) };
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function stabilityFactor(stability: Stability): number {
  if (stability === "low") return 1.25;
  if (stability === "high") return 0.75;
  return 1;
}

export function spreadHalfDeg(settings: ConeSettings): number {
  return (settings.spreadDeg * stabilityFactor(settings.stability)) / 2;
}

export function estimateScentDistanceMeters(
  windSpeedKmh: number,
  minutes: number,
  stability: Stability,
): number {
  const base = windSpeedKmh * 1000 * (minutes / 60) * 0.28 * stabilityFactor(stability);
  return Math.max(20, base);
}

export function buildConePolygon(
  lkp: LatLng,
  windFromDeg: number,
  windSpeed: number,
  settings: ConeSettings,
): LatLng[] {
  const windToDeg = windFromToDeg(windFromDeg);
  const speedKmh = windSpeed;
  const lengthM = Math.max(250, speedKmh * 1000 * settings.timeHorizonHours * 0.28);
  const halfSpread = spreadHalfDeg(settings);
  const steps = 22;

  const polygon: LatLng[] = [lkp];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = windToDeg - halfSpread + (i / steps) * halfSpread * 2;
    polygon.push(destinationPoint(lkp, bearing, lengthM));
  }
  polygon.push(lkp);
  return polygon;
}

export function buildConeDistanceBands(
  lkp: LatLng,
  windFromDeg: number,
  windSpeedKmh: number,
  settings: ConeSettings,
  minutesList: number[] = [15, 30, 60],
): ConeDistanceBand[] {
  const windToDeg = windFromToDeg(windFromDeg);
  const halfSpread = spreadHalfDeg(settings);

  return minutesList.map((minutes) => {
    const distanceM = estimateScentDistanceMeters(windSpeedKmh, minutes, settings.stability);
    return {
      minutes,
      distanceM,
      center: destinationPoint(lkp, windToDeg, distanceM),
      left: destinationPoint(lkp, windToDeg - halfSpread, distanceM),
      right: destinationPoint(lkp, windToDeg + halfSpread, distanceM),
    };
  });
}

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function computeTrackMetrics(
  laidTrack: PointSample[],
  dogTrack: PointSample[],
  cone: LatLng[],
): TrackMetrics {
  if (!laidTrack.length || !dogTrack.length) {
    return {
      minSeparationM: 0,
      avgSeparationM: 0,
      maxSeparationM: 0,
      dogInsideConePct: 0,
      laidTrackTransitions: 0,
    };
  }

  const separations = dogTrack.map((dog) => {
    let min = Number.POSITIVE_INFINITY;
    for (const laid of laidTrack) {
      min = Math.min(min, haversineMeters(dog, laid));
    }
    return min;
  });

  const minSeparationM = Math.min(...separations);
  const maxSeparationM = Math.max(...separations);
  const avgSeparationM = separations.reduce((a, b) => a + b, 0) / separations.length;

  const insideCount = dogTrack.filter((p) => pointInPolygon(p, cone)).length;
  const dogInsideConePct = (insideCount / dogTrack.length) * 100;

  let transitions = 0;
  let prevInside = pointInPolygon(laidTrack[0], cone);
  for (let i = 1; i < laidTrack.length; i += 1) {
    const inside = pointInPolygon(laidTrack[i], cone);
    if (inside !== prevInside) transitions += 1;
    prevInside = inside;
  }

  return {
    minSeparationM,
    avgSeparationM,
    maxSeparationM,
    dogInsideConePct,
    laidTrackTransitions: transitions,
  };
}

export function nearestPointForPlayback(track: PointSample[], progress: number): LatLng | null {
  if (!track.length) return null;
  const tsPoints = track.filter((p) => p.ts && Number.isFinite(new Date(p.ts).getTime()));
  if (tsPoints.length >= 2) {
    const sorted = [...tsPoints].sort(
      (a, b) => new Date(a.ts as string).getTime() - new Date(b.ts as string).getTime(),
    );
    const start = new Date(sorted[0].ts as string).getTime();
    const end = new Date(sorted[sorted.length - 1].ts as string).getTime();
    const target = start + progress * (end - start);
    let best = sorted[0];
    let bestDelta = Math.abs(new Date(sorted[0].ts as string).getTime() - target);
    for (const p of sorted) {
      const delta = Math.abs(new Date(p.ts as string).getTime() - target);
      if (delta < bestDelta) {
        best = p;
        bestDelta = delta;
      }
    }
    return { lat: best.lat, lng: best.lng };
  }

  const idx = Math.min(track.length - 1, Math.max(0, Math.round(progress * (track.length - 1))));
  return { lat: track[idx].lat, lng: track[idx].lng };
}
