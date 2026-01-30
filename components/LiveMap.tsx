import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import ConeCanvas, { downloadCanvasPNG, downloadCanvasPNG_ICS } from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";

const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), { ssr: false });

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

    const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11); // mph
  const [manualFromDeg, setManualFromDeg] = useState<number>(315); // wind FROM degrees
const [icsNotes, setIcsNotes] = useState<string>("");

  const [latlon, setLatlon] = useState<{ lat: number; lon: number } | null>(null);
  const [wind, setWind] = useState<WindData | null>(null);

  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Canvas size matches the actual map container size (so pixels line up)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });

  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

    async function fetchWind(lat: number, lon: number) {
    setWind(null);

    const r = await fetch("/api/wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, mode: windMode === "hourly" ? "hourly" : "current" }),
    });

    const js = await r.json();
    if (!r.ok) throw new Error(js?.error || "Wind fetch failed");
    setWind(js);
  }
  const effectiveWind: WindData | null =
    windMode === "manual"
      ? {
          wind_speed_mps: manualSpeedMph / 2.236936,
          wind_dir_from_deg: manualFromDeg,
          time_local: "manual",
          time_utc: "manual",
          timezone: "manual",
          utc_offset_seconds: 0,
        } as any
      : wind;


  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: 520,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <LeafletMapInner
          center={center}
          zoom={zoom}
          onMapClick={async (lat, lon, px, py) => {
  setLatlon({ lat, lon });
  setSrcPoint({ x: px, y: py });

  if (windMode === "manual") return;

  try {
    await fetchWind(lat, lon);
  } catch (e: any) {
    alert(e?.message || String(e));
  }
}}

        />

        {/* IMPORTANT: zIndex puts the canvas ABOVE the map tiles */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 999 }}>
          <ConeCanvas
            width={size.w}
            height={size.h}
            srcPoint={srcPoint}
            wind={effectiveWind}
            lengthPx={lengthPx}
            halfAngleDeg={halfAngle}
            label={
              latlon
                ? `Source @ ${latlon.lat.toFixed(5)}, ${latlon.lon.toFixed(5)}`
                : "Click map to set source"
            }
          />
        </div>
      </div>

      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Live Map Controls</h3>

        <div
          style={{
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            background: "#0b1220",
            color: "white",
            padding: 10,
            borderRadius: 10,
          }}
        >
          {latlon ? `lat: ${latlon.lat}\nlon: ${latlon.lon}\n` : "Click map to set source point\n"}
         {wind
  ? `wind_from_deg: ${wind.wind_dir_from_deg}
wind_speed_mps: ${wind.wind_speed_mps}
time_local: ${(wind as any).time_local ?? "n/a"} ${(wind as any).timezone ?? ""}
time_utc: ${(wind as any).time_utc ?? "n/a"}
source: ${(wind as any).source ?? "n/a"}`
  : "wind: (not fetched yet)"}

        </div>
        <label style={{ display: "block", marginTop: 12 }}>Wind source</label>
        <select
          value={windMode}
          onChange={async (e) => {
            const v = e.target.value as any;
            setWindMode(v);

            // If switching to auto and we already have a point, fetch immediately
            if ((v === "current" || v === "hourly") && latlon) {
              try {
                // set state first; small delay ensures windMode is updated
                setTimeout(() => fetchWind(latlon.lat, latlon.lon), 0);
              } catch {}
            }
          }}
          style={{ width: "100%", padding: 10, borderRadius: 10 }}
        >
          <option value="current">Auto (Current)</option>
          <option value="hourly">Auto (Hourly)</option>
          <option value="manual">Manual</option>
        </select>

        {windMode === "manual" && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <input
              type="number"
              value={manualSpeedMph}
              onChange={(e) => setManualSpeedMph(Number(e.target.value))}
              placeholder="Wind speed (mph)"
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
            />
            <input
              type="number"
              value={manualFromDeg}
              onChange={(e) => setManualFromDeg(Number(e.target.value))}
              placeholder="Wind FROM degrees (0=N,90=E)"
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
            />
          </div>
        )}

        <label style={{ display: "block", marginTop: 12 }}>Cone length</label>
        <input
          type="range"
          min={150}
          max={1200}
          value={lengthPx}
          onChange={(e) => setLengthPx(Number(e.target.value))}
          style={{ width: "100%" }}
        />

        <label style={{ display: "block", marginTop: 12 }}>Half-angle</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setHalfAngle("auto")} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
            Auto
          </button>
          <input
            type="number"
            min={5}
            max={60}
            value={halfAngle === "auto" ? 18 : halfAngle}
            onChange={(e) => setHalfAngle(Number(e.target.value))}
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
            disabled={halfAngle === "auto"}
          />
        </div>

        <button
          onClick={() => {
            const canv = containerRef.current?.querySelector("canvas");
            if (canv) downloadCanvasPNG(canv as HTMLCanvasElement, "scent_cone_live.png");
          }}
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12 }}
        >
          Export PNG (overlay)
        </button>
        <button
  onClick={() => {
    const canv = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canv) return;

    // Build metadata
    const mph =
      windMode === "manual"
        ? manualSpeedMph
        : (effectiveWind?.wind_speed_mps ?? 0) * 2.236936;

    downloadCanvasPNG_ICS(canv, "scent_cone_live_ics.png", {
      notes: icsNotes,
      lat: latlon?.lat,
      lon: latlon?.lon,
      windSource: windMode,
      windFromDeg: effectiveWind?.wind_dir_from_deg,
      windSpeedMps: effectiveWind?.wind_speed_mps,
      windSpeedMph: Number.isFinite(mph) ? mph : undefined,
      timeLocal: (effectiveWind as any)?.time_local ?? (wind as any)?.time_local ?? "n/a",
      timeUtc: (effectiveWind as any)?.time_utc ?? (wind as any)?.time_utc ?? "n/a",
      coneLengthPx: lengthPx,
      coneHalfAngleDeg: halfAngle,
    });
  }}
  style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 12 }}
>
  Export PNG (ICS Footer)
</button>

      </div>
    </div>
    
  );
}


