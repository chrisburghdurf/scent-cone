import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas, { downloadDataUrlPNG_ICS } from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";

const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), { ssr: false });

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // Source is stored as LAT/LON (stable)
  const [sourceLL, setSourceLL] = useState<{ lat: number; lon: number } | null>(null);
  // Pixel position is derived from map view + sourceLL
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  const [wind, setWind] = useState<WindData | null>(null);

  // Cone controls
  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  // Wind source controls
  const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // Keep source until cleared
  const [lockSource, setLockSource] = useState(true);

  // ICS notes
  const [icsNotes, setIcsNotes] = useState<string>("");

  // User location controls
  const [showUserLocation, setShowUserLocation] = useState(true);
  const [followUser, setFollowUser] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // Map + export refs
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Size for overlay canvas (match container)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });

  // Responsive: stack on mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 820);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Keep overlay sized to container
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function recomputeSrcPoint(map: LeafletMap | null, ll: { lat: number; lon: number } | null) {
    // Force Leaflet to redraw when layout changes (mobile orientation, resize)
useEffect(() => {
  if (!mapRef.current) return;
  setTimeout(() => {
    mapRef.current?.invalidateSize();
    recomputeSrcPoint(mapRef.current, sourceLL);
  }, 150);
}, [isMobile]);

    if (!map || !ll) {
      setSrcPoint(null);
      return;
    }
    const pt = map.latLngToContainerPoint([ll.lat, ll.lon]);
    setSrcPoint({ x: pt.x, y: pt.y });
  }

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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 360px",
        gap: 16,
        alignItems: "start",
      }}
    >
      {/* MAP AREA */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: isMobile ? "65svh" : 520,
          minHeight: isMobile ? 420 : 520,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        <div ref={exportRef} style={{ position: "absolute", inset: 0 }}>
          <LeafletMapInner
            center={center}
            zoom={zoom}
            onMapReady={(m) => {
              mapRef.current = m;
              // On ready, compute source pixel if it exists
              recomputeSrcPoint(m, sourceLL);
            }}
            onViewChanged={(m) => {
              // On pan/zoom/resize, re-project source to pixels so it stays pinned
              recomputeSrcPoint(m, sourceLL);
            }}
            onMapClick={async (lat, lon) => {
              // If locked and a source exists, ignore clicks until user clears/unlocks
              if (lockSource && sourceLL) return;

              const next = { lat, lon };
              setSourceLL(next);

              // Immediately compute pixel position using current map
              recomputeSrcPoint(mapRef.current, next);

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
                sourceLL
                  ? `Source @ ${sourceLL.lat.toFixed(5)}, ${sourceLL.lon.toFixed(5)}`
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
              <li><b>Lock source</b> keeps the point fixed until you clear/unlock it.</li>
              <li><b>Wind source</b>: Current / Hourly / Manual.</li>
              <li><b>Wind FROM degrees</b>: 0=N, 90=E, 180=S, 270=W.</li>
              <li><b>ICS Export</b> saves map + cone + footer.</li>
            </ul>
          </div>
        </details>

        {/* Source controls */}
        <label style={{ display: "block", marginTop: 10 }}>Source point</label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={lockSource}
              onChange={(e) => setLockSource(e.target.checked)}
            />
            Lock source until cleared
          </label>

          <button
            onClick={() => {
              setSourceLL(null);
              setSrcPoint(null);
              setWind(null);
            }}
            style={{ padding: 10, borderRadius: 10 }}
            disabled={!sourceLL}
          >
            Clear source
          </button>
        </div>

        {/* Wind source */}
        <label style={{ display: "block", marginTop: 12 }}>Wind source</label>
        <select
          value={windMode}
          onChange={(e) => {
            const v = e.target.value as "current" | "hourly" | "manual";
            setWindMode(v);

            if ((v === "current" || v === "hourly") && sourceLL) {
              setTimeout(() => fetchWind(sourceLL.lat, sourceLL.lon), 0);
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

        {/* User location */}
        <label style={{ display: "block", marginTop: 12 }}>My location</label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showUserLocation}
              onChange={(e) => setShowUserLocation(e.target.checked)}
            />
            Show my location
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

        {/* Cone controls */}
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
          placeholder="Example: Expect pooling near tree line SE of source."
          style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 10 }}
        />

        {/* Export */}
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
              lat: sourceLL?.lat,
              lon: sourceLL?.lon,
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
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12 }}
        >
          Export PNG (Map + Cone + ICS Footer)
        </button>
      </div>
    </div>
  );
}




