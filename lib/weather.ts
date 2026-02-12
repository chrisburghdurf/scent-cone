import { Mode, WeatherSnapshot } from "@/lib/types";

interface WeatherResponse {
  ok: boolean;
  error?: string;
  weather?: WeatherSnapshot;
}

export async function fetchWeather(mode: Mode, lat: number, lng: number, requestedTime: string) {
  const params = new URLSearchParams({
    mode,
    lat: String(lat),
    lng: String(lng),
    requestedTime,
  });

  const res = await fetch(`/api/weather?${params.toString()}`);
  const json = (await res.json()) as WeatherResponse;

  if (!res.ok || !json.ok || !json.weather) {
    throw new Error(json.error ?? "Weather fetch failed");
  }

  return json.weather;
}
