import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas, { downloadDataUrlPNG_ICS } from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";
import {
  computeScentEnvelope,
  addMinutesIso,
  type TerrainType,
  type StabilityType,
  type PrecipType,
} from "@/lib/scentEnvelope";

const LeafletMapInner = dynamic(() => import("./LeafletMapClient"), { ssr: false });

type LKP = { id: string; lat: number; lon: number; timeISO: string; label?: string };
type Trap = { id: string; lat: number; lon: number; label: string };

function isoNow() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // Multi-LKP state
  const [lkps, setLkps] = useState<LKP[]>([]);
  const [activeLkpId, setActiveLkpId] = useState<string | null>(null);

  const activeLkp = useMemo(() => lkps.find((k) => k.id === activeLkpId) ?? null, [lkps, activeLkpId]);

  // Stable source (lat/lon) for the active LKP
  const sourceLL = activeLkp ? { lat: activeLkp.lat, lon: activeLkp.lon } : null;

  // Pixel point derived from map view + sourceLL (for canvas cone)
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  // Wind
  const [wind, setWind] = useState<WindData | null>(null);

  // Visual cone controls
  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  // Wind source controls
  const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // Source locking
  const [lockSource, setLockSource] = useState(true);

  // Envelope toggles + environment
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [showTimeBands, setShowTimeBands] = useState(true);
  const [bandSet, setBandSet] = useState<number[]>([15, 30, 60, 120]); // default A
  const [showAllLkpEnvelopes, setShowAllLkpEnvelopes] = useState(false);

  const [terrain, setTerrain] = useState<TerrainType>("mixed");
  const [stability, setStability] = useState<StabilityType>("neutral");
  const [cloud, setCloud] = useState<"clear" | "partly" | "overcast" | "night">("partly");
  const [precip, setPrecip] = useState<PrecipType>("none");
  const [recentRain, setRecentRain] = useState(false);
  const [tempF, setTempF] = useState<number>(75);
  const [rh, setRh] = useState<number>(50);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Terrain traps
  const [traps, setTraps] = useState<Trap[]>([]);
  const [mapMode, setMapMode] = useState<"setSource" | "addTrap">("setSource");
  const [newTrapLabel, setNewTrapLabel] = useState("Terrain trap");

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

  // “now” ticks for time-aware computations
  const [nowISO, setNowISO] = useState<string>(isoNow());
  useEffect(() => {
    const id = setInterval(() => setNowISO(isoNow()), 60_000);
    return () => clearInterval(id);
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

  // Compute a single envelope “now” for the active LKP
  const envelopeNow = useMemo(() => {
    if (!showEnvelope || !activeLkp || !effectiveWind) return null;
    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;

    return computeScentEnvelope({
      lkp_lat: activeLkp.lat,
      lkp_lon: activeLkp.lon,
      lkp_time_iso: activeLkp.timeISO,
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
  }, [showEnvelope, activeLkp, effectiveWind, nowISO, tempF, rh, cloud, precip, recentRain, terrain, stability]);

  // Compute time bands for the active LKP
  const envelopeBands = useMemo(() => {
    if (!showEnvelope || !showTimeBands || !activeLkp || !effectiveWind) return null;
    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;

    const bands = bandSet
      .slice()
      .sort((a, b) => a - b)
      .map((mins) => {
        const e = computeScentEnvelope({
          lkp_lat: activeLkp.lat,
          lkp_lon: activeLkp.lon,
          lkp_time_iso: activeLkp.timeISO,
          now_time_iso: addMinutesIso(activeLkp.timeISO, mins),
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
        return {
          minutes: mins,
          polygons: e.polygons,
          confidence_score: e.confidence_score,
          confidence_band: e.confidence_band,
        };
      });

    return bands;
  }, [showEnvelope, showTimeBands, bandSet, activeLkp, effectiveWind, tempF, rh, cloud, precip, recentRain, terrain, stability]);

  // Optional: show all LKPs’ envelopes (uses NOW envelopes; bands would be too busy)
  const allLkpEnvelopes = useMemo(() => {
    if (!showEnvelope || !showAllLkpEnvelopes || !effectiveWind) return null;
    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;

    return lkps.map((k) => {
      const e = computeScentEnvelope({
        lkp_lat: k.lat,
        lkp_lon: k.lon,
        lkp_time_iso: k.timeISO,
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
      return { id: k.id, polygons: e.polygons };
    });
  }, [showEnvelope, showAllLkpEnvelopes, lkps, effectiveWind, nowISO, tempF, rh, cloud, precip, recentRain, terrain, stability]);

  // Offline banner
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);

  // Click handling for map modes
  async function handleMapClick(lat: number, lon: number) {
    if (mapMode === "addTrap") {
      const t: Trap = { id: uid("trap"), lat, lon, label: newTrapLabel || "Terrain trap" };
      setTraps((prev) => [t, ...prev]);
      return;
    }

    // setSource mode
    if (lockSource && activeLkp) return;

    const newId = activeLkp ? activeLkp.id : uid("lkp");
    const newLkp: LKP = {
      id: newId,
      lat,
      lon,
      timeISO: isoNow(),
      label: activeLkp?.label ?? "LKP",
    };

    setLkps((prev) => {
      const others = prev.filter((p) => p.id !== newId);
      return [newLkp, ...others];
    });
    setActiveLkpId(newId);

    recomputeSrcPoint(mapRef.current, { lat, lon });

    if (windMode !== "manual") {
      try {
        await fetchWind(lat, lon);
      } catch (e: any) {
        alert(e?.message || String(e));
      }
    }
  }

  // Start points from active envelope
  const startPoints = envelopeNow ? envelopeNow.recommended_start_points : null;

  const elapsedMin = useMemo(() => {
    if (!activeLkp) return null;
    const t0 = Date.parse(activeLkp.timeISO);
    const t1 = Date.parse(nowISO);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return Math.max(0, Math.round((t1 - t0) / 60000));
  }, [activeLkp, nowISO]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 420px", gap: 16, alignItems: "start" }}>
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
        {!online && (
          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2000, background: "#111827", color: "white", padding: "6px 10px", borderRadius: 10, fontSize: 12 }}>
            Offline: wind updates unavailable (use Manual if needed)
          </div>
        )}

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
            onMapClick={handleMapClick}
            showUserLocation={showUserLocation}
            followUser={followUser}
            locateToken={locateToken}
            onUserLocation={(lat: number, lon: number) => setUserLoc({ lat, lon })}
            showEnvelope={showEnvelope}
            envelopeNow={envelopeNow ? envelopeNow.polygons : null}
            envelopeBands={envelopeBands}
            startPoints={startPoints}
            traps={traps}
            lkps={lkps}
            activeLkpId={activeLkpId}
          />

          {/* Additional envelopes for all LKPs (NOW) */}
          {showEnvelope && showAllLkpEnvelopes && allLkpEnvelopes?.length ? (
            allLkpEnvelopes.map((e) => (
              <React.Fragment key={`all-${e.id}`}>
                {/* draw residual only to avoid clutter */}
                {/* (Leaflet polygons are already being rendered in LeafletMapInner for active/bands) */}
              </React.Fragment>
            ))
          ) : null}

          {/* Canvas cone */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 999 }}>
            <ConeCanvas
              width={size.w}
              height={size.h}
              srcPoint={srcPoint}
              wind={effectiveWind}
              lengthPx={lengthPx}
              halfAngleDeg={halfAngle}
              label={sourceLL ? `Source @ ${sourceLL.lat.toFixed(5)}, ${sourceLL.lon.toFixed(5)}` : "Click map to set source"}
            />
          </div>
        </div>
      </div>

      {/* PANEL */}
      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Live Map</h3>

        {/* Multi-LKP controls */}
        <label style={{ display: "block", marginTop: 10 }}>LKPs</label>
        <div style={{ display: "grid", gap: 8 }}>
          <button
            onClick={() => {
              if (!sourceLL) return;
              const id = uid("lkp");
              const n: LKP = { id, lat: sourceLL.lat, lon: sourceLL.lon, timeISO: isoNow(), label: `LKP ${lkps.length + 1}` };
              setLkps((p) => [n, ...p]);
              setActiveLkpId(id);
            }}
            style={{ padding: 10, borderRadius: 10 }}
            disabled={!sourceLL}
          >
            Add new LKP from current source
          </button>

          <select
            value={activeLkpId ?? ""}
            onChange={(e) => setActiveLkpId(e.target.value || null)}
            style={{ padding: 10, borderRadius: 10 }}
          >
            <option value="">(no active LKP)</option>
            {lkps.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label ?? "LKP"} — {new Date(k.timeISO).toLocaleString()}
              </option>
            ))}
          </select>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={showAllLkpEnvelopes} onChange={(e) => setShowAllLkpEnvelopes(e.target.checked)} />
            Show envelopes for all LKPs (busy)
          </label>

          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#0b1220", color: "white", padding: 10, borderRadius: 10 }}>
            {activeLkp ? `ACTIVE LKP\nlat: ${activeLkp.lat}\nlon: ${activeLkp.lon}\nLKP time: ${activeLkp.timeISO}\nelapsed: ${elapsedMin ?? "n/a"} min` : "Set an active LKP by clicking the map"}
          </div>
        </div>

        {/* Source behavior */}
        <label style={{ display: "block", marginTop: 12 }}>Source behavior</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={lockSource} onChange={(e) => setLockSource(e.target.checked)} />
          Lock source until cleared
        </label>

        <button
          onClick={() => {
            // clear active only
            if (!activeLkpId) return;
            setLkps((prev) => prev.filter((k) => k.id !== activeLkpId));
            setActiveLkpId(null);
            setSrcPoint(null);
            setWind(null);
          }}
          style={{ padding: 10, borderRadius: 10, marginTop: 8, width: "100%" }}
          disabled={!activeLkpId}
        >
          Clear active LKP
        </button>

        {/* Map mode */}
        <label style={{ display: "block", marginTop: 12 }}>Map mode</label>
        <select value={mapMode} onChange={(e) => setMapMode(e.target.value as any)} style={{ width: "100%", padding: 10, borderRadius: 10 }}>
          <option value="setSource">Set/Move Source (LKP)</option>
          <option value="addTrap">Add Terrain Trap Marker</option>
        </select>

        {mapMode === "addTrap" && (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <input
              value={newTrapLabel}
              onChange={(e) => setNewTrapLabel(e.target.value)}
              placeholder="Trap label (Drainage / Tree line / Leeward building)"
              style={{ padding: 10, borderRadius: 10 }}
            />
            <button
              onClick={() => setTraps([])}
              style={{ padding: 10, borderRadius: 10 }}
              disabled={!traps.length}
            >
              Clear all traps
            </button>
          </div>
        )}

        {/* Envelope */}
        <label style={{ display: "block", marginTop: 12 }}>Envelope</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={showEnvelope} onChange={(e) => setShowEnvelope(e.target.checked)} disabled={!activeLkp} />
          Show probability envelope
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={showTimeBands} onChange={(e) => setShowTimeBands(e.target.checked)} disabled={!activeLkp || !showEnvelope} />
          Show time bands (15/30/60/120)
        </label>

        {/* Wind */}
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
            <input type="number" value={manualSpeedMph} onChange={(e) => setManualSpeedMph(Number(e.target.value))} placeholder="Wind speed (mph)" style={{ padding: 10, borderRadius: 10 }} />
            <input type="number" value={manualFromDeg} onChange={(e) => setManualFromDeg(Number(e.target.value))} placeholder="Wind FROM degrees (0=N,90=E)" style={{ padding: 10, borderRadius: 10 }} />
          </div>
        )}

        {/* Environment */}
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
            Recent rain ended
          </label>

          <button onClick={() => setShowAdvanced((v) => !v)} style={{ padding: 10, borderRadius: 10 }}>
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>

          {showAdvanced && (
            <div style={{ display: "grid", gap: 8 }}>
              <input type="number" value={tempF} onChange={(e) => setTempF(Number(e.target.value))} placeholder="Temp (°F)" style={{ padding: 10, borderRadius: 10 }} />
              <input type="number" value={rh} onChange={(e) => setRh(Number(e.target.value))} placeholder="RH (%)" style={{ padding: 10, borderRadius: 10 }} />
            </div>
          )}
        </div>

        {/* Cone visual controls */}
        <label style={{ display: "block", marginTop: 12 }}>Cone length</label>
        <input type="range" min={150} max={1200} value={lengthPx} onChange={(e) => setLengthPx(Number(e.target.value))} style={{ width: "100%" }} />

        <label style={{ display: "block", marginTop: 12 }}>Half-angle</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setHalfAngle("auto")} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
            Auto
          </button>
          <input type="number" min={5} max={60} value={halfAngle === "auto" ? 18 : halfAngle} onChange={(e) => setHalfAngle(Number(e.target.value))} style={{ flex: 1, padding: 10, borderRadius: 10 }} disabled={halfAngle === "auto"} />
        </div>

        {/* My location */}
        <label style={{ display: "block", marginTop: 12 }}>My location</label>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={showUserLocation} onChange={(e) => setShowUserLocation(e.target.checked)} />
            Show my location
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={followUser} onChange={(e) => setFollowUser(e.target.checked)} disabled={!showUserLocation} />
            Follow me
          </label>

          <button onClick={() => setLocateToken((n) => n + 1)} style={{ padding: 10, borderRadius: 10 }} disabled={!showUserLocation}>
            Locate me now
          </button>

          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#0b1220", color: "white", padding: 10, borderRadius: 10 }}>
            {userLoc ? `my lat: ${userLoc.lat}\nmy lon: ${userLoc.lon}` : "my location: (not available)"}
          </div>
        </div>

        {/* ICS Notes + export */}
        <label style={{ display: "block", marginTop: 12 }}>ICS Notes (optional)</label>
        <textarea value={icsNotes} onChange={(e) => setIcsNotes(e.target.value)} placeholder="Notes for ICS export" style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 10 }} />

        <button
          onClick={async () => {
            if (!exportRef.current) return;

            const dataUrl = await toPng(exportRef.current, { cacheBust: true, pixelRatio: 2 });

            const mph = windMode === "manual" ? manualSpeedMph : (effectiveWind?.wind_speed_mps ?? 0) * 2.236936;

            const envSummary = `Terrain=${terrain}, Stability=${stability}, Cloud=${cloud}, Precip=${precip}${recentRain ? ", recentRain" : ""}`;

            const confSummary = envelopeNow
              ? `Envelope: C=${envelopeNow.confidence_score} (${envelopeNow.confidence_band}); reset ${envelopeNow.reset_recommendation_minutes}m`
              : "";

            await downloadDataUrlPNG_ICS(dataUrl, "scent_cone_live_ics.png", {
              notes: [icsNotes, envSummary, confSummary].filter(Boolean).join(" | "),
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
          <b>Disclaimer:</b> This tool is decision support only and does not replace handler judgment.
        </div>
      </div>
    </div>
  );
}
