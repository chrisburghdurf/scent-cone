import type { NextApiRequest, NextApiResponse } from "next";

type Mode = "current" | "hourly" | "historical";

function normDeg(d: number) {
  return ((d % 360) + 360) % 360;
}

function toDateStrUTC(iso: string) {
  // YYYY-MM-DD in UTC
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nearestIndex(times: string[], targetIso: string) {
  const target = Date.parse(targetIso);
  let bestI = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo hourly time strings typically like "2026-01-30T02:00"
    const t = Date.parse(times[i] + "Z");
    const d = Math.abs(t - target);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    const { lat, lon, mode, time_iso } = req.body || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      res.status(400).json({ error: "Invalid lat/lon" });
      return;
    }

    const modeSafe: Mode =
      mode === "hourly" ? "hourly" : mode === "historical" ? "historical" : "current";

    // ---------- HISTORICAL (Open-Meteo Archive) ----------
    if (modeSafe === "historical") {
      if (!time_iso || typeof time_iso !== "string") {
        res.status(400).json({ error: "Missing time_iso for historical mode" });
        return;
      }

      const day = toDateStrUTC(time_iso);

      // Open-Meteo Archive API (free): hourly winddirection_10m + windspeed_10m
      // timezone=auto to return local time strings + timezone metadata
      const url =
        `https://archive-api.open-meteo.com/v1/archive` +
        `?latitude=${encodeURIComponent(latNum)}` +
        `&longitude=${encodeURIComponent(lonNum)}` +
        `&start_date=${day}&end_date=${day}` +
        `&hourly=windspeed_10m,winddirection_10m` +
        `&wind_speed_unit=ms` +
        `&timezone=auto`;

      const r = await fetch(url);
      const text = await r.text();
      if (!r.ok) {
        res.status(502).json({ error: "Open-Meteo Archive error", status: r.status, body: text.slice(0, 800) });
        return;
      }

      const js = JSON.parse(text);
      const timezone: string | null = js?.timezone ?? null;
      const offsetSec: number = Number(js?.utc_offset_seconds ?? 0);

      const times: string[] = js?.hourly?.time || [];
      const speeds: number[] = js?.hourly?.windspeed_10m || [];
      const dirs: number[] = js?.hourly?.winddirection_10m || [];

      if (!times.length || !speeds.length || !dirs.length) {
        res.status(500).json({ error: "Unexpected archive response", sample: js });
        return;
      }

      const i = nearestIndex(times, time_iso);

      // times[i] is local-ish string; keep it for time_local, derive UTC via offset
      const timeLocal = times[i] ? `${times[i]}` : null;

      function makeUtcIso(timeLocalStr: string | null) {
        if (!timeLocalStr) return null;
        const localMs = Date.parse(timeLocalStr + "Z");
        const utcMs = localMs - offsetSec * 1000;
        return new Date(utcMs).toISOString();
      }

      res.status(200).json({
        source: "open-meteo-archive",
        mode: "historical",
        requested_time_iso: time_iso,
        time_local: timeLocal,
        time_utc: makeUtcIso(timeLocal),
        timezone,
        utc_offset_seconds: offsetSec,
        wind_speed_mps: Number(speeds[i]),
        wind_dir_from_deg: normDeg(Number(dirs[i])),
        note: "historical hourly wind (nearest)",
      });
      return;
    }

    // ---------- CURRENT/HOURLY (Open-Meteo Forecast) ----------
    // Request BOTH current + hourly so we can always return something
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
        const tMs = Date.parse(times[i] + "Z");
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

    function makeUtcIso(timeLocalStr: string | null) {
      if (!timeLocalStr) return null;
      const localMs = Date.parse(timeLocalStr + "Z");
      const utcMs = localMs - offsetSec * 1000;
      return new Date(utcMs).toISOString();
    }

    // Choose based on requested mode, with fallback
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
