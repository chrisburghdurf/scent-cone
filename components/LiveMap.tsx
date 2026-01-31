import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas, { downloadDataUrlPNG_ICS } from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";
import { computeScentEnvelope, type TerrainType, type StabilityType, type PrecipType } from "@/lib/scentEnvelope";

const LeafletMapInner = dynamic(() => import("./LeafletMapClient"), { ssr: false });

function isoNow() {
  return new Date().toISOString();
}

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // Source stored as LAT/LON (stable through pan/zoom)
  const [sourceLL, setSourceLL] = useState<{ lat: number; lon: number } | null>(null);

  // Pixel point derived from map view + sourceLL
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  // LKP time for envelope
  const [lkpTimeISO, setLkpTimeISO] = useState<string>(isoNow());

  // “Now” ticks for time-aware envelope
  const [nowISO, setNowISO] = useState<string>(isoNow());
  useEffect(() => {
    const id = setInterval(() => setNowISO(isoNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [wind, setWind] = useState<WindData | null>(null);

  // Cone controls (visual)
  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  // Wind source controls
  const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // Keep source until cleared
  const [lockSource, setLockSource] = useState(true);

  // Envelope toggles + environment defaults
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [terrain, setTerrain] = useState<TerrainType>("mixed");
  const [stability, setStability] = useState<StabilityType>("neutral");
  const [cloud, setCloud] = useState<"clear" | "partly" | "overcast" | "night">("partly");
  const [precip, setPrecip] = useState<PrecipType>("none");
  const [recentRain, setRecentRain] = useState(false);

  // Optional advanced inputs (keep simple)
  const [tempF, setTempF] = useState<number>(75);
  const [rh, setRh] = useState<number>(50);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ICS notes
  const [icsNotes, setIcsNotes] = useState<string>("");

  // User location
  const [showUserLocation, setShowUserLocation] = useState(true);
  const [followUser, setFollowUser] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // Map + export refs
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Overlay size matches container
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });

  // Responsive layout
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 820);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
    if (!map || !ll) {
      setSrcPoint(null);
      return;
    }
    const pt = map.latLngToContainerPoint([ll.lat, ll.lon]);
    setSrcPoint({ x: pt.x, y: pt.y });
  }

  // Force Leaflet redraw on layout changes (mobile Safari)
  useEffect(() => {
    if (!mapRef.current) return;
    setTimeout(() => {
      mapRef.current?.invalidateSize();
      recomputeSrcPoint(mapRef.current, sourceLL);
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

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

  // --- Envelope compute (memoized) ---
  const envelope = useMemo(() => {
    if (!showEnvelope) return null;
    if (!sourceLL) return null;
    if (!effectiveWind) return null;

    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;

    return computeScentEnvelope({
      lkp_lat: sourceLL.lat,
      lkp_lon: sourceLL.lon,
      lkp_time_iso: lkpTimeISO,
      now_time_iso: nowISO,
      wind_from_deg: effectiveWind.wind_dir_from_deg,
      wind_speed_mph: windSpeedMph,

      temperature_f: tempF,
      rel_humidity_pct: rh,
      cloud,
      precip,
      recent_rain: recentRain,
      terrain,
      stability,
    });
  }, [
    showEnvelope,
    sourceLL,
    effectiveWind,
    lkpTimeISO,
    nowISO,
    tempF,
    rh,
    cloud,
    precip,
    recentRain,
    terrain,
    stability,
  ]);

  const elapsedMin = useMemo(() => {
    if (!lkpTimeISO) return null;
    const t0 = Date.parse(lkpTimeISO);
    const t1 = Date.parse(nowISO);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return Math.max(0, Math.round((t1 - t0) / 60000));
  }, [lkpTimeISO, nowISO]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 380px",
        gap: 16,
        alignItems: "start",
      }}
    >
      {/* MAP */}
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
            onMapReady={(m: LeafletMap) => {
              mapRef.current = m;
              recomputeSrcPoint(m, sourceLL);
            }}
            onViewChanged={(m: LeafletMap) => {
              recomputeSrcPoint(m, sourceLL);
            }}
            onMapClick={async (lat: number, lon: number) => {
              if (lockSource && sourceLL) return;

              const next = { lat, lon };
              setSourceLL(next);

              // when you set a source, default LKP time to “now”
              const now = isoNow();
              setLkpTimeISO(now);

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
            onUserLocation={(lat: number, lon: number) => setUserLoc({ lat, lon })}
            showEnvelope={showEnvelope}
            envelopePolygons={envelope ? envelope.polygons : null}
            startPoints={envelope ? envelope.recommended_start_points : null}
          />

          {/* Cone overlay (canvas) */}
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

      {/* PANEL */}
      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Live Map</h3>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to use</summary>
          <div style={{ marginTop: 8, color: "#374151", fontSize: 13, lineHeight: 1.4 }}>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li><b>Click the map</b> to set the source point.</li>
              <li><b>Lock source</b> keeps it fixed until cleared/unlocked.</li>
              <li><b>Envelope</b> is decision support (not a route prediction).</li>
              <li><b>Wind FROM degrees</b>: 0=N, 90=E, 180=S, 270=W.</li>
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
            {sourceLL
              ? `lkp lat: ${sourceLL.lat}\nlkp lon: ${sourceLL.lon}\nLKP time: ${lkpTimeISO}\nelapsed: ${elapsedMin ?? "n/a"} min`
              : "Set a source point to begin"}
          </div>
        </div>

        {/* LKP time input */}
        <label style={{ display: "block", marginTop: 12 }}>LKP time (local)</label>
        <input
          type="datetime-local"
          value={lkpTimeISO.slice(0, 16)}
          onChange={(e) => {
            // datetime-local returns "YYYY-MM-DDTHH:MM"
            const v = e.target.value;
            if (!v) return;
            // interpret as local time, convert to ISO
            const dt = new Date(v);
            setLkpTimeISO(dt.toISOString());
          }}
          style={{ width: "100%", padding: 10, borderRadius: 10 }}
          disabled={!sourceLL}
        />

        {/* Envelope toggle */}
        <label style={{ display: "block", marginTop: 12 }}>Envelope</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showEnvelope}
            onChange={(e) => setShowEnvelope(e.target.checked)}
            disabled={!sourceLL}
          />
          Show time-aware probability envelope
        </label>

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

        {/* Envelope environment controls */}
        <label style={{ display: "block", marginTop: 12 }}>Environment</label>
        <div style={{ display: "grid", gap: 8 }}>
          <select value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainType)} style={{ padding: 10, borderRadius: 10 }}>
            <option value="mixed">Terrain: mixed</option>
            <option value="open">Terrain: open</option>
            <option value="forest">Terrain: forest</option>
            <option value="urban">Terrain: urban</option>
            <option value="swamp">Terrain: swamp</option>
            <option value="beach">Terrain: beach</option>
          </select>

          <select value={stability} onChange={(e) => setStability(e.target.value as StabilityType)} style={{ padding: 10, borderRadius: 10 }}>
            <option value="neutral">Stability: neutral</option>
            <option value="stable">Stability: stable/night</option>
            <option value="convective">Stability: convective/sunny</option>
          </select>

          <select value={cloud} onChange={(e) => setCloud(e.target.value as any)} style={{ padding: 10, borderRadius: 10 }}>
            <option value="partly">Cloud: partly</option>
            <option value="clear">Cloud: clear</option>
            <option value="overcast">Cloud: overcast</option>
            <option value="night">Cloud: night</option>
          </select>

          <select value={precip} onChange={(e) => setPrecip(e.target.value as PrecipType)} style={{ padding: 10, borderRadius: 10 }}>
            <option value="none">Precip: none</option>
            <option value="light">Precip: light</option>
            <option value="moderate">Precip: moderate</option>
            <option value="heavy">Precip: heavy</option>
          </select>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={recentRain} onChange={(e) => setRecentRain(e.target.checked)} />
            Recent rain ended (conservative)
          </label>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ padding: 10, borderRadius: 10 }}
          >
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>

          {showAdvanced && (
            <div style={{ display: "grid", gap: 8 }}>
              <input
                type="number"
                value={tempF}
                onChange={(e) => setTempF(Number(e.target.value))}
                placeholder="Temp (°F)"
                style={{ padding: 10, borderRadius: 10 }}
              />
              <input
                type="number"
                value={rh}
                onChange={(e) => setRh(Number(e.target.value))}
                placeholder="RH (%)"
                style={{ padding: 10, borderRadius: 10 }}
              />
            </div>
          )}
        </div>

        {/* Envelope output */}
        {envelope && (
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
            {`Envelope confidence: ${envelope.confidence_score} (${envelope.confidence_band})
Reset recommendation: ${envelope.reset_recommendation_minutes} min
Notes:
- ${envelope.deployment_notes.join("\n- ") || "n/a"}`}
          </div>
        )}

        {/* My location controls */}
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

        {/* Cone visual controls */}
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

        {/* ICS notes + export */}
        <label style={{ display: "block", marginTop: 12 }}>ICS Notes (optional)</label>
        <textarea
          value={icsNotes}
          onChange={(e) => setIcsNotes(e.target.value)}
          placeholder="Example: Expect pooling near drainage SE of LKP."
          style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 10 }}
        />

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

            const envelopeSummary = envelope
              ? `Envelope: C=${envelope.confidence_score} (${envelope.confidence_band}); reset ${envelope.reset_recommendation_minutes}m`
              : "";

            await downloadDataUrlPNG_ICS(dataUrl, "scent_cone_live_ics.png", {
              notes: [icsNotes, envelopeSummary].filter(Boolean).join(" | "),
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

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          <b>Disclaimer:</b> Envelope is decision support only. It does not predict subject route and does not replace handler judgment.
        </div>
      </div>
    </div>
  );
}






