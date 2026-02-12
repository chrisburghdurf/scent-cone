import { LatLng, PoolingResult, PoolingSensitivity } from "@/lib/types";

interface TerrainCell {
  center: LatLng;
  elevation: number;
  polygon: LatLng[];
}

interface TerrainResponse {
  ok: boolean;
  source: string;
  generatedAt: string;
  cells: TerrainCell[];
  error?: string;
}

function scoreCell(
  cell: TerrainCell,
  avgElevation: number,
  minElevation: number,
  maxElevation: number,
  lkp: LatLng,
  windToDeg: number,
): number {
  const elevRange = Math.max(1, maxElevation - minElevation);
  const lowFactor = (avgElevation - cell.elevation + elevRange / 2) / elevRange;

  const dx = cell.center.lng - lkp.lng;
  const dy = cell.center.lat - lkp.lat;
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  let delta = Math.abs(bearing - windToDeg);
  if (delta > 180) delta = 360 - delta;
  const downwindFactor = Math.max(0, 1 - delta / 90);

  return Math.max(0, Math.min(1, lowFactor * 0.65 + downwindFactor * 0.35));
}

function thresholdForSensitivity(s: PoolingSensitivity): number {
  if (s === "low") return 0.72;
  if (s === "high") return 0.45;
  return 0.58;
}

export async function fetchPoolingOverlay(
  lkp: LatLng,
  windToDeg: number,
  radiusKm: number,
  sensitivity: PoolingSensitivity,
): Promise<PoolingResult> {
  const params = new URLSearchParams({
    lat: String(lkp.lat),
    lng: String(lkp.lng),
    radiusKm: String(radiusKm),
    sensitivity,
  });

  const res = await fetch(`/api/terrain?${params.toString()}`);
  const json = (await res.json()) as TerrainResponse;

  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? "Terrain fetch failed");
  }

  const elevations = json.cells.map((c) => c.elevation).filter((v) => Number.isFinite(v));
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const avgElevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;
  const threshold = thresholdForSensitivity(sensitivity);

  const cells = json.cells
    .map((cell) => ({
      polygon: cell.polygon,
      score: scoreCell(cell, avgElevation, minElevation, maxElevation, lkp, windToDeg),
    }))
    .filter((cell) => cell.score >= threshold);

  return {
    cells,
    source: json.source,
    generatedAt: json.generatedAt,
    disclaimer: "Planning/training estimate—field conditions vary.",
  };
}
