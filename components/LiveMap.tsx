import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas, { downloadDataUrlPNG_ICS, downloadCanvasPNG } from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";

const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), { ssr: false });

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  const [latlon, setLatlon] = useState<{ lat: number; lon: number } | null>(null);
  const [wind, setWind] = useState<WindData | null>(null);
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  // Cone controls
  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  // Wind source controls
  const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // ICS notes
  const [icsNotes, setIcsNotes] = useState<string>("");

  // User location controls
  const [showUserLocation, setShowUserLocation] = useState(true);
  const [followUser, setFollowUser] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // Container sizing for overlay canvas
  const containerRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
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
      ? ({
          wind_speed_mps: manualSpeedMph / 2.236936,
          wind_dir_from_deg: manualFromDeg,
          time_local: "manual",
          time_utc: "manual",
          timezone: "manual",
          utc_offset_seconds: 0,
        } as any)
      : wind;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
      {/* MAP AREA */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: 520,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        {/* This wrapper is what we capture for export (map + cone) */}
        <div ref={exportRef} style={{ position: "absolute", inset: 0 }}>
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
            showUserLocation={showUserLocation}
            followUser={followUser}
            locateToken={locateToken}
            onUserLocation={(lat, lon) => setUserLoc({ lat, lon })}
          />

          {/* Overlay cone */}
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
      </div>

      {/* CONTROL PANEL */}
      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Live Map</h3>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to use</summary>
          <div style={{ marginTop: 8, color: "#374151", fontSize: 13, lineHeight: 1.4 }}>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li><b>Click the map</b> to set the scent source point.</li>
              <li><b>Wind source</b>: Current = real-time estimate; Hourly = nearest forecast hour; Manual = your input.</li>
              <li><b>Wind FROM degrees</b>: 0=N, 90=E, 180=S, 270=W (direction the wind is coming from).</li>
              <li>Adjust <b>cone length</b> and <b>half-angle</b> for terrain and confidence.</li>
              <li><b>ICS Export</b> saves map + cone + a footer block for briefings and documentation.</li>
            </ul>
          </div>
        </details>

        {/* Wind source */}
        <label style={{ display: "block", marginTop: 10 }}>Wind source</label>
        <select
          value={windMode}
          onChange={(e) => {
            const v = e.target.value as "current" | "hourly" | "manual";
            setWindMode(v);

            if ((v === "current" || v === "hourly") && latlon) {
              setTimeout(() => fetchWind(latlon.lat, latlon.lon), 0);
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

        {/* Display */}
        <div
          style={{
            marginTop: 12,
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
          {effectiveWind
            ? `wind_from_deg: ${effectiveWind.wind_dir_from_deg}\nwind_speed_mps: ${effectiveWind.wind_speed_mps}\n`
            : "wind: (not fetched yet)\n"}
          {wind && (wind as any).time_local ? `time_local: ${(wind as any).time_local}\n` : ""}
          {wind && (wind as any).timezone ? `timezone: ${(wind as any).timezone}\n` : ""}
        </div>

        {/* User location */}
        <label style={{ display: "block", marginTop: 12 }}>My location</label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showUserLocation}
              onChange={(e) => setShowUserLocation(e.target.checked)}
            />
            Show my location on map
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={followUser}
              onChange={(e) => setFollowUser(e.target.checked)}
              disabled={!showUserLocation}
            />
            Follow me
          </label>

          <button
            onClick={() => setLocateToken((n) => n + 1)}
            style={{ padding: 10, borderRadius: 10 }}
            disabled={!showUserLocation}
          >
            Locate me now
          </button>

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
            {userLoc ? `my lat: ${userLoc.lat}\nmy lon: ${userLoc.lon}` : "my location: (not available)"}
          </div>
        </div>

        {/* Cone settings */}
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

        {/* ICS notes */}
        <label style={{ display: "block", marginTop: 12 }}>ICS Notes (optional)</label>
        <textarea
          value={icsNotes}
          onChange={(e) => setIcsNotes(e.target.value)}
          placeholder="Example: LKP at trailhead. Expect pooling near tree line and drainage SE of source."
          style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 10 }}
        />

        {/* Export buttons */}
        <button
          onClick={() => {
            const canv = containerRef.current?.querySelector("canvas");
            if (canv) downloadCanvasPNG(canv as HTMLCanvasElement, "scent_cone_overlay.png");
          }}
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12 }}
        >
          Export PNG (overlay only)
        </button>

        <button
          onClick={async () => {
            if (!exportRef.current) return;

            const dataUrl = await toPng(exportRef.current, {
              cacheBust: true,
              pixelRatio: 2,
            });

            const mph =
              windMode === "manual"
                ? manualSpeedMph
                : (effectiveWind?.wind_speed_mps ?? 0) * 2.236936;

            await downloadDataUrlPNG_ICS(dataUrl, "scent_cone_live_ics.png", {
              notes: icsNotes,
              lat: latlon?.lat,
              lon: latlon?.lon,
              windSource: windMode,
              windFromDeg: effectiveWind?.wind_dir_from_deg,
              windSpeedMps: effectiveWind?.wind_speed_mps,
              windSpeedMph: Number.isFinite(mph) ? mph : undefined,
              timeLocal: (wind as any)?.time_local ?? "n/a",
              timeUtc: (wind as any)?.time_utc ?? "n/a",
              coneLengthPx: lengthPx,
              coneHalfAngleDeg: halfAngle,
            });
          }}
          style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 12 }}
        >
          Export PNG (Map + Cone + ICS Footer)
        </button>
      </div>
    </div>
  );
}



