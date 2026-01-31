import type { NextApiRequest, NextApiResponse } from "next";

type Mode = "current" | "hourly";

function normDeg(d: number) {
  return ((d % 360) + 360) % 360;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    const { lat, lon, mode } = req.body || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);
    const modeSafe: Mode = mode === "hourly" ? "hourly" : "current";

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      res.status(400).json({ error: "Invalid lat/lon" });
      return;
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${encodeURIComponent(latNum)}` +
      `&longitude=${encodeURIComponent(lonNum)}` +
      `&current=wind_speed_10m,wind_direction_10m` +
      `&hourly=windspeed_10m,winddirection_10m` +
      `&wind_speed_unit=ms` +
      `&timezone=auto`;

    const r = await fetch(url);
    const text = await r.text();

    if (!r.ok) {
      res.status(502).json({ error: "Open-Meteo error", status: r.status, body: text.slice(0, 800) });
      return;
    }

    const js = JSON.parse(text);

    const timezone: string | null = js?.timezone ?? null;
    const offsetSec: number = Number(js?.utc_offset_seconds ?? 0);

    // CURRENT
    const curTime: string | null = js?.current?.time ?? null; // local time string
    const curSpeed: number | null =
      js?.current?.wind_speed_10m != null ? Number(js.current.wind_speed_10m) : null;
    const curDir: number | null =
      js?.current?.wind_direction_10m != null ? normDeg(Number(js.current.wind_direction_10m)) : null;

    // HOURLY
    const times: string[] = js?.hourly?.time || [];
    const speeds: number[] = js?.hourly?.windspeed_10m || [];
    const dirs: number[] = js?.hourly?.winddirection_10m || [];

    function nearestHourlyIndex() {
      if (!times.length) return 0;
      const now = Date.now();
      let bestI = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < times.length; i++) {
        const tMs = new Date(times[i] + "Z").getTime();
        const d = Math.abs(tMs - now);
        if (d < best) {
          best = d;
          bestI = i;
        }
      }
      return bestI;
    }

    const hi = nearestHourlyIndex();
    const hrTime: string | null = times[hi] ?? null;
    const hrSpeed: number | null = speeds[hi] != null ? Number(speeds[hi]) : null;
    const hrDir: number | null = dirs[hi] != null ? normDeg(Number(dirs[hi])) : null;

    function makeUtcIso(timeLocal: string | null) {
      if (!timeLocal) return null;
      const localMs = new Date(timeLocal + "Z").getTime();
      const utcMs = localMs - offsetSec * 1000;
      return new Date(utcMs).toISOString();
    }

    let chosen = {
      source: "open-meteo" as const,
      mode: modeSafe,
      time_local: null as string | null,
      time_utc: null as string | null,
      timezone,
      utc_offset_seconds: offsetSec,
      wind_speed_mps: null as number | null,
      wind_dir_from_deg: null as number | null,
      note: "" as string,
    };

    if (modeSafe === "current" && curSpeed != null && curDir != null) {
      chosen.time_local = curTime;
      chosen.time_utc = makeUtcIso(curTime);
      chosen.wind_speed_mps = curSpeed;
      chosen.wind_dir_from_deg = curDir;
      chosen.note = "current wind";
    } else if (hrSpeed != null && hrDir != null) {
      chosen.time_local = hrTime;
      chosen.time_utc = makeUtcIso(hrTime);
      chosen.wind_speed_mps = hrSpeed;
      chosen.wind_dir_from_deg = hrDir;
      chosen.note = modeSafe === "hourly" ? "nearest hourly wind" : "current unavailable; fell back to hourly";
    } else if (curSpeed != null && curDir != null) {
      chosen.time_local = curTime;
      chosen.time_utc = makeUtcIso(curTime);
      chosen.wind_speed_mps = curSpeed;
      chosen.wind_dir_from_deg = curDir;
      chosen.note = "hourly unavailable; fell back to current";
    } else {
      res.status(500).json({ error: "No wind data returned from Open-Meteo", timezone, sample: js });
      return;
    }

    res.status(200).json(chosen);
  } catch (err: any) {
    res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}




