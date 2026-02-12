import type { NextApiRequest, NextApiResponse } from "next";
import { PoolingSensitivity } from "@/lib/types";

interface TerrainCell {
  center: { lat: number; lng: number };
  elevation: number;
  polygon: Array<{ lat: number; lng: number }>;
}

type ApiResult =
  | { ok: true; source: string; generatedAt: string; cells: TerrainCell[] }
  | { ok: false; error: string };

function gridSizeForSensitivity(s: PoolingSensitivity): number {
  if (s === "low") return 9;
  if (s === "high") return 15;
  return 11;
}

function makeGrid(lat: number, lng: number, radiusKm: number, sensitivity: PoolingSensitivity) {
  const size = gridSizeForSensitivity(sensitivity);
  const cells: Array<{ lat: number; lng: number; halfLat: number; halfLng: number }> = [];

  const latRadius = radiusKm / 111;
  const lngRadius = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const latStep = (latRadius * 2) / size;
  const lngStep = (lngRadius * 2) / size;

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const cellLat = lat - latRadius + latStep * (r + 0.5);
      const cellLng = lng - lngRadius + lngStep * (c + 0.5);
      cells.push({ lat: cellLat, lng: cellLng, halfLat: latStep / 2, halfLng: lngStep / 2 });
    }
  }

  return cells;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResult>) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radiusKm ?? 2);
    const sensitivity = (req.query.sensitivity as PoolingSensitivity) ?? "medium";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Invalid coordinates" });
    }

    const grid = makeGrid(lat, lng, Math.max(0.5, Math.min(radiusKm, 8)), sensitivity);
    const locations = grid.map((p) => `${p.lat},${p.lng}`).join("|");
    const url = `https://api.opentopodata.org/v1/aster30m?locations=${encodeURIComponent(locations)}`;

    const terrainRes = await fetch(url);
    if (!terrainRes.ok) throw new Error("Terrain provider error");
    const terrain = await terrainRes.json();

    if (!Array.isArray(terrain.results) || terrain.results.length !== grid.length) {
      throw new Error("Terrain grid mismatch");
    }

    const cells: TerrainCell[] = grid.map((g, idx) => ({
      center: { lat: g.lat, lng: g.lng },
      elevation: Number(terrain.results[idx]?.elevation ?? NaN),
      polygon: [
        { lat: g.lat - g.halfLat, lng: g.lng - g.halfLng },
        { lat: g.lat - g.halfLat, lng: g.lng + g.halfLng },
        { lat: g.lat + g.halfLat, lng: g.lng + g.halfLng },
        { lat: g.lat + g.halfLat, lng: g.lng - g.halfLng },
      ],
    }));

    return res.status(200).json({
      ok: true,
      source: "OpenTopodata ASTER30m",
      generatedAt: new Date().toISOString(),
      cells,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error instanceof Error ? error.message : "Terrain fetch failed" });
  }
}
