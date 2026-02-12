import type { NextApiRequest, NextApiResponse } from "next";
import { Mode, WeatherSnapshot } from "@/lib/types";

type ApiResult =
  | { ok: true; weather: WeatherSnapshot }
  | { ok: false; error: string };

function pickClosestIndex(times: string[], requestedIso: string): number {
  const target = new Date(requestedIso).getTime();
  let bestIdx = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  times.forEach((t, idx) => {
    const delta = Math.abs(new Date(t).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function toDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function ensureUtcIso(value: string): string {
  if (!value) return value;
  if (/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
}

async function fetchLive(lat: number, lng: number, requestedTime: string): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    "&current=temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m&timezone=UTC";

  const res = await fetch(url);
  if (!res.ok) throw new Error("Live weather provider error");
  const data = await res.json();

  if (!data.current) throw new Error("No live weather payload");

  return {
    windSpeed: Number(data.current.wind_speed_10m ?? 0),
    windSpeedUnit: data.current_units?.wind_speed_10m ?? "km/h",
    windFromDeg: Number(data.current.wind_direction_10m ?? 0),
    temperatureC: Number(data.current.temperature_2m ?? 0),
    dewPointC: Number(data.current.dew_point_2m ?? 0),
    requestedTime,
    resolvedTime: ensureUtcIso(data.current.time),
    source: "Open-Meteo",
    kind: "live",
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchHistorical(
  lat: number,
  lng: number,
  requestedTime: string,
): Promise<WeatherSnapshot> {
  const day = toDateOnly(requestedTime);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${day}&end_date=${day}` +
    "&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m&timezone=UTC";

  const res = await fetch(url);
  if (!res.ok) throw new Error("Historical weather provider error");
  const data = await res.json();

  const times: string[] = data.hourly?.time ?? [];
  if (!times.length) throw new Error("No historical weather data returned");
  const idx = pickClosestIndex(times, requestedTime);

  return {
    windSpeed: Number(data.hourly.wind_speed_10m[idx] ?? 0),
    windSpeedUnit: data.hourly_units?.wind_speed_10m ?? "km/h",
    windFromDeg: Number(data.hourly.wind_direction_10m[idx] ?? 0),
    temperatureC: Number(data.hourly.temperature_2m[idx] ?? 0),
    dewPointC: Number(data.hourly.dew_point_2m[idx] ?? 0),
    requestedTime,
    resolvedTime: ensureUtcIso(times[idx]),
    source: "Open-Meteo Archive",
    kind: "historical",
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchForecast(lat: number, lng: number, requestedTime: string): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    "&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m&forecast_days=16&timezone=UTC";

  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast weather provider error");
  const data = await res.json();

  const times: string[] = data.hourly?.time ?? [];
  if (!times.length) throw new Error("No forecast weather data returned");
  const idx = pickClosestIndex(times, requestedTime);

  return {
    windSpeed: Number(data.hourly.wind_speed_10m[idx] ?? 0),
    windSpeedUnit: data.hourly_units?.wind_speed_10m ?? "km/h",
    windFromDeg: Number(data.hourly.wind_direction_10m[idx] ?? 0),
    temperatureC: Number(data.hourly.temperature_2m[idx] ?? 0),
    dewPointC: Number(data.hourly.dew_point_2m[idx] ?? 0),
    requestedTime,
    resolvedTime: ensureUtcIso(times[idx]),
    source: "Open-Meteo Forecast",
    kind: "forecast",
    lastUpdated: new Date().toISOString(),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResult>) {
  try {
    const mode = (req.query.mode as Mode) ?? "live";
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const requestedTime = String(req.query.requestedTime ?? new Date().toISOString());

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "Invalid coordinates" });
    }

    let weather: WeatherSnapshot;
    if (mode === "live") weather = await fetchLive(lat, lng, requestedTime);
    else if (mode === "historical") weather = await fetchHistorical(lat, lng, requestedTime);
    else weather = await fetchForecast(lat, lng, requestedTime);

    return res.status(200).json({ ok: true, weather });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: error instanceof Error ? error.message : "Weather fetch failed" });
  }
}
