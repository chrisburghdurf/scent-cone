import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import { toPng } from "html-to-image";

import ConeCanvas from "@/components/ConeCanvas";
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
function mpsToMph(mps: number) {
  return mps * 2.236936;
}
function mphToMps(mph: number) {
  return mph / 2.236936;
}
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function localInputToIso(v: string) {
  return new Date(v).toISOString();
}
function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export default function LiveMap() {
  // ===== Map defaults =====
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // ===== Layout (mobile) =====
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ===== App mode =====
  const [appMode, setAppMode] = useState<"live" | "scenario">("live");

  // ===== Live LKPs =====
  const [lkps, setLkps] = useState<LKP[]>([]);
  const [activeLkpId, setActiveLkpId] = useState<string | null>(null);
  const activeLkp = useMemo(() => lkps.find((k) => k.id === activeLkpId) ?? null, [lkps, activeLkpId]);

  // Lock the source point (live)
  const [lockSource, setLockSource] = useState(true);

  // ===== Scenario inputs (time+location) =====
  const [scenarioLL, setScenarioLL] = useState<{ lat: number; lon: number } | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("Scenario");
  const [scenarioLkpISO, setScenarioLkpISO] = useState<string>(isoNow());
  const [scenarioElapsedMin, setScenarioElapsedMin] = useState<number>(60);

  // Selected LKP/LL depending on mode
  const selectedLL = useMemo(() => {
    if (appMode === "live") {
      return activeLkp ? { lat: activeLkp.lat, lon: activeLkp.lon } : null;
    }
    return scenarioLL;
  }, [appMode, activeLkp, scenarioLL]);

  // Virtual LKP object for scenario calculations
  const scenarioLkp: LKP | null = useMemo(() => {
    if (!scenarioLL) return null;
    return {
      id: "scenario",
      lat: scenarioLL.lat,
      lon: scenarioLL.lon,
      timeISO: scenarioLkpISO,
      label: scenarioLabel || "Scenario",
    };
  }, [scenarioLL, scenarioLkpISO, scenarioLabel]);

  const activeForModel: LKP | null = useMemo(() => {
    return appMode === "live" ? activeLkp : scenarioLkp;
  }, [appMode, activeLkp, scenarioLkp]);

  // ===== Wind =====
  const [wind, setWind] = useState<WindData | null>(null);
  const [windMode, setWindMode] = useState<"current" | "hourly" | "historical" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // Manual wind becomes "effective wind" even if API wind exists
  const effectiveWind: WindData | null = useMemo(() => {
    if (windMode === "manual") {
      return {
        wind_speed_mps: mphToMps(manualSpeedMph),
        wind_dir_from_deg: manualFromDeg,
        time_utc: "manual",
        time_local: "manual",
        timezone: "manual",
        utc_offset_seconds: 0,
      } as any;
    }
    return wind;
  }, [windMode, manualSpeedMph, manualFromDeg, wind]);

  // ===== Environmental inputs for envelope model =====
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [showTimeBands, setShowTimeBands] = useState(true);
  const [bandSet, setBandSet] = useState<number[]>([15, 30, 60, 120]);

  const [tempF, setTempF] = useState<number>(75);
  const [rh, setRh] = useState<number>(50);
  const [cloud, setCloud] = useState<"clear" | "partly" | "overcast" | "night">("partly");
  const [precip, setPrecip] = useState<PrecipType>("none");
  const [recentRain, setRecentRain] = useState(false);
  const [terrain, setTerrain] = useState<TerrainType>("mixed");
  const [stability, setStability] = useState<StabilityType>("neutral");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ===== Visual cone controls (Canvas overlay) =====
  const [lengthPx, setLengthPx] = useState(700);
  const [halfAngleDeg, setHalfAngleDeg] = useState<"auto" | number>("auto");

  // ===== Traps =====
  const [traps, setTraps] = useState<Trap[]>([]);
  const [mapMode, setMapMode] = useState<"setSource" | "addTrap">("setSource");
  const [newTrapLabel, setNewTrapLabel] = useState("Terrain trap");

  // ===== User location =====
  // ✅ OFF by default
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [followUser, setFollowUser] = useState(false);

  // Requests a location fix (marker update)
  const [locateToken, setLocateToken] = useState(0);
  // One-time recenter request (handled in LeafletMapInner)
  const [centerOnMeToken, setCenterOnMeToken] = useState(0);

  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // Force OFF on mount (prevents sticky behavior from any prior UI/state)
  useEffect(() => {
    setShowUserLocation(false);
    setFollowUser(false);
  }, []);

  // ===== Online/offline banner =====
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

  // ===== "Now" clock tick (live) =====
  const [nowISO, setNowISO] = useState<string>(isoNow());
  useEffect(() => {
    if (appMode !== "live") return;
    const id = setInterval(() => setNowISO(isoNow()), 30_000);
    return () => clearInterval(id);
  }, [appMode]);

  // ===== Refs =====
  const mapRef = useRef<LeafletMap | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Overlay pixel size
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 700 });

  useEffect(() => {
    if (!mapWrapRef.current) return;
    const el = mapWrapRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Canvas source point in pixel coords
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  function recomputeSrcPoint(map: LeafletMap | null, ll: { lat: number; lon: number } | null) {
    if (!map || !ll) {
      setSrcPoint(null);
      return;
    }
    const pt = map.latLngToContainerPoint([ll.lat, ll.lon]);
    setSrcPoint({ x: pt.x, y: pt.y });
  }

  // ===== Wind fetch (Open-Meteo API via /api/wind) =====
  async function fetchWind(lat: number, lon: number) {
    if (windMode === "manual") return;

    setWind(null);

    const modeSafe =
      windMode === "hourly" ? "hourly" : windMode === "historical" ? "historical" : "current";

    const body: any = { lat, lon, mode: modeSafe };

    if (modeSafe === "historical") {
      // Use scenario LKP time
      body.time_iso = scenarioLkpISO;
    }

    const r = await fetch("/api/wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const js = await r.json();
    if (!r.ok) throw new Error(js?.error || "Wind fetch failed");
    setWind(js);
  }

  // ===== Envelope model outputs =====
  const envelopeNow = useMemo(() => {
    if (!showEnvelope || !activeForModel || !effectiveWind) return null;

    const windSpeedMph = mpsToMph(effectiveWind.wind_speed_mps);

    const nowForModel =
      appMode === "scenario"
        ? addMinutesIso(activeForModel.timeISO, scenarioElapsedMin)
        : nowISO;

    return computeScentEnvelope({
      lkp_lat: activeForModel.lat,
      lkp_lon: activeForModel.lon,
      lkp_time_iso: activeForModel.timeISO,
      now_time_iso: nowForModel,
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
    activeForModel,
    effectiveWind,
    appMode,
    scenarioElapsedMin,
    nowISO,
    tempF,
    rh,
    cloud,
    precip,
    recentRain,
    terrain,
    stability,
  ]);

  const envelopeBands = useMemo(() => {
    if (!showEnvelope || !showTimeBands || !activeForModel || !effectiveWind) return null;

    const windSpeedMph = mpsToMph(effectiveWind.wind_speed_mps);

    return bandSet
      .slice()
      .sort((a, b) => a - b)
      .map((mins) => {
        const e = computeScentEnvelope({
          lkp_lat: activeForModel.lat,
          lkp_lon: activeForModel.lon,
          lkp_time_iso: activeForModel.timeISO,
          now_time_iso: addMinutesIso(activeForModel.timeISO, mins),
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
  }, [
    showEnvelope,
    showTimeBands,
    bandSet,
    activeForModel,
    effectiveWind,
    tempF,
    rh,
    cloud,
    precip,
    recentRain,
    terrain,
    stability,
  ]);

  const startPoints = envelopeNow ? envelopeNow.recommended_start_points : null;

  // ===== Map click handling =====
  async function onMapClick(lat: number, lon: number) {
    // Add trap mode
    if (mapMode === "addTrap") {
      setTraps((prev) => [{ id: uid("trap"), lat, lon, label: newTrapLabel || "Terrain trap" }, ...prev]);
      return;
    }

    // Scenario: click sets the scenario location
    if (appMode === "scenario") {
      setScenarioLL({ lat, lon });
      recomputeSrcPoint(mapRef.current, { lat, lon });

      // Fetch wind for that place/time if not manual
      try {
        await fetchWind(lat, lon);
      } catch (e: any) {
        alert(e?.message || String(e));
      }
      return;
    }

    // Live: respect lock
    if (lockSource && activeLkp) return;

    const id = activeLkp?.id ?? uid("lkp");
    const lkp: LKP = { id, lat, lon, timeISO: isoNow(), label: activeLkp?.label ?? "LKP" };

    setLkps((prev) => [lkp, ...prev.filter((p) => p.id !== id)]);
    setActiveLkpId(id);

    // Sync pixel point
    recomputeSrcPoint(mapRef.current, { lat, lon });

    // Fetch wind if not manual
    try {
      await fetchWind(lat, lon);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  // Recompute srcPoint whenever view changes
  function onViewChanged(map: LeafletMap) {
    recomputeSrcPoint(map, selectedLL);
  }

  // Map ready
  function onMapReady(map: LeafletMap) {
    mapRef.current = map;
    recomputeSrcPoint(map, selectedLL);
  }

  // ===== Export (Map + Cone overlay + any footer in that DOM) =====
  async function exportPNG() {
    if (!exportRef.current) return;

    const dataUrl = await toPng(exportRef.current, {
      cacheBust: true,
      pixelRatio: 2,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadDataUrl(dataUrl, `scent_cone_export_${stamp}.png`);
  }

  // ===== UI helpers =====
  const windText = useMemo(() => {
    if (!effectiveWind) return "(not fetched yet)";
    const mph = mpsToMph(effectiveWind.wind_speed_mps);
    const from = Math.round(effectiveWind.wind_dir_from_deg);
    return `from ${from}° @ ${mph.toFixed(1)} mph`;
  }, [effectiveWind]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 460px",
        gap: 16,
        alignItems: "start",
      }}
    >
      {/* MAP AREA */}
      <div
        ref={mapWrapRef}
        style={{
          position: "relative",
          width: "100%",
          height: isMobile ? "65svh" : 560,
          minHeight: isMobile ? 420 : 560,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        {!online && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 2000,
              background: "#111827",
              color: "white",
              padding: "6px 10px",
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            Offline: wind updates unavailable (use Manual wind if needed)
          </div>
        )}

        {/* Everything inside exportRef gets captured */}
        <div ref={exportRef} style={{ position: "absolute", inset: 0 }}>
          <LeafletMapInner
            center={center}
            zoom={zoom}
            onMapClick={onMapClick}
            onMapReady={onMapReady}
            onViewChanged={onViewChanged}
            showUserLocation={showUserLocation}
            followUser={followUser}
            locateToken={locateToken}
            centerOnMeToken={centerOnMeToken}
            onUserLocation={(lat: number, lon: number) => setUserLoc({ lat, lon })}
            showEnvelope={showEnvelope}
            envelopeNow={envelopeNow ? envelopeNow.polygons : null}
            envelopeBands={envelopeBands}
            startPoints={startPoints}
            traps={traps}
            lkps={appMode === "live" ? lkps : (scenarioLkp ? [scenarioLkp] : [])}
            activeLkpId={appMode === "live" ? activeLkpId : (scenarioLkp ? scenarioLkp.id : null)}
          />

          {/* Canvas overlay cone (visual estimate) */}
          <div style={{ position: "absolute", inset: 0, zIndex: 999, pointerEvents: "none" }}>
            <ConeCanvas
              width={size.w}
              height={size.h}
              srcPoint={srcPoint}
              wind={effectiveWind}
              lengthPx={lengthPx}
              halfAngleDeg={halfAngleDeg}
              label={
                selectedLL
                  ? `Point @ ${selectedLL.lat.toFixed(5)}, ${selectedLL.lon.toFixed(5)}`
                  : "Click map to set point"
              }
            />
          </div>

          {/* Optional footer visible in export */}
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              zIndex: 1500,
              background: "rgba(0,0,0,0.55)",
              color: "white",
              padding: "6px 10px",
              borderRadius: 10,
              fontSize: 12,
              maxWidth: "70%",
            }}
          >
            {envelopeNow
              ? `Confidence: ${envelopeNow.confidence_score} (${envelopeNow.confidence_band}) • Wind ${windText}`
              : `Wind ${windText}`}
          </div>
        </div>
      </div>

      {/* CONTROL PANEL */}
      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>TrailCast Planner</h3>

        {/* Mode switch */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setAppMode("live")}
            style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: appMode === "live" ? 700 : 500 }}
          >
            Live
          </button>
          <button
            onClick={() => setAppMode("scenario")}
            style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: appMode === "scenario" ? 700 : 500 }}
          >
            Scenario / Historical
          </button>
        </div>

        {/* Live instructions */}
        {appMode === "live" && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#f9fafb", fontSize: 13 }}>
            <b>Live mode:</b> click the map to set the point. Lock keeps the point fixed until you unlock.
          </div>
        )}

        {/* Scenario controls */}
        {appMode === "scenario" && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
            <b>Scenario / Historical</b>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#6b7280" }}>LKP Label</label>
              <input
                value={scenarioLabel}
                onChange={(e) => setScenarioLabel(e.target.value)}
                style={{ padding: 10, borderRadius: 10 }}
              />

              <label style={{ fontSize: 12, color: "#6b7280" }}>LKP Date/Time (local)</label>
              <input
                type="datetime-local"
                value={isoToLocalInput(scenarioLkpISO)}
                onChange={(e) => setScenarioLkpISO(localInputToIso(e.target.value))}
                style={{ padding: 10, borderRadius: 10 }}
              />

              <label style={{ fontSize: 12, color: "#6b7280" }}>Minutes since LKP</label>
              <input
                type="number"
                min={0}
                max={24 * 60}
                value={scenarioElapsedMin}
                onChange={(e) => setScenarioElapsedMin(Number(e.target.value))}
                style={{ padding: 10, borderRadius: 10 }}
              />

              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Click on the map to set the scenario location.
              </div>

              {scenarioLL && (
                <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                  lat: {scenarioLL.lat.toFixed(6)}
                  <br />
                  lon: {scenarioLL.lon.toFixed(6)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live lock */}
        {appMode === "live" && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={lockSource}
                onChange={(e) => setLockSource(e.target.checked)}
              />
              Lock point (keeps LKP fixed until unlocked)
            </label>
          </div>
        )}

        {/* Wind controls */}
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Wind</b>

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <select
              value={windMode}
              onChange={(e) => setWindMode(e.target.value as any)}
              style={{ padding: 10, borderRadius: 10 }}
            >
              <option value="current">Current (Open-Meteo)</option>
              <option value="hourly">Hourly (Open-Meteo)</option>
              <option value="historical">Historical (Scenario time)</option>
              <option value="manual">Manual</option>
            </select>

            {windMode === "manual" ? (
              <>
                <label style={{ fontSize: 12, color: "#6b7280" }}>Wind speed (mph)</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  value={manualSpeedMph}
                  onChange={(e) => setManualSpeedMph(Number(e.target.value))}
                  style={{ padding: 10, borderRadius: 10 }}
                />
                <label style={{ fontSize: 12, color: "#6b7280" }}>Wind from (deg)</label>
                <input
                  type="number"
                  min={0}
                  max={360}
                  step={1}
                  value={manualFromDeg}
                  onChange={(e) => setManualFromDeg(Number(e.target.value))}
                  style={{ padding: 10, borderRadius: 10 }}
                />
              </>
            ) : (
              <button
                onClick={async () => {
                  if (!selectedLL) {
                    alert("Set a point first (click the map).");
                    return;
                  }
                  try {
                    await fetchWind(selectedLL.lat, selectedLL.lon);
                  } catch (e: any) {
                    alert(e?.message || String(e));
                  }
                }}
                style={{ padding: 10, borderRadius: 10 }}
                disabled={!selectedLL}
              >
                Fetch wind for selected point
              </button>
            )}

            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
              wind: {windText}
            </div>
          </div>
        </div>

        {/* Live location controls */}
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Live Location</b>

          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showUserLocation}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowUserLocation(on);

                  // ✅ marker update only (NO recenter)
                  if (on) setLocateToken((n) => n + 1);

                  // turning off also disables follow
                  if (!on) setFollowUser(false);
                }}
              />
              Show my location (does not lock map)
            </label>
          </div>

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <button
              onClick={() => {
                if (!showUserLocation) setShowUserLocation(true);
                setLocateToken((n) => n + 1);
                setCenterOnMeToken((n) => n + 1); // ✅ one-time recenter
              }}
              style={{ padding: 10, borderRadius: 10 }}
            >
              Center on me (one-time)
            </button>

            <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: showUserLocation ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={followUser}
                disabled={!showUserLocation}
                onChange={(e) => setFollowUser(e.target.checked)}
              />
              Follow me (optional)
            </label>

            {userLoc && (
              <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                you: {userLoc.lat.toFixed(6)}, {userLoc.lon.toFixed(6)}
              </div>
            )}
          </div>
        </div>

        {/* Cone drawing controls */}
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Cone (visual)</b>

          <label style={{ display: "block", marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Length (px)
          </label>
          <input
            type="range"
            min={200}
            max={1800}
            value={lengthPx}
            onChange={(e) => setLengthPx(Number(e.target.value))}
            style={{ width: "100%" }}
          />

          <label style={{ display: "block", marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Half-angle
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setHalfAngleDeg("auto")}
              style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: halfAngleDeg === "auto" ? 700 : 500 }}
            >
              Auto
            </button>
            <input
              type="number"
              min={5}
              max={60}
              value={halfAngleDeg === "auto" ? 18 : halfAngleDeg}
              onChange={(e) => setHalfAngleDeg(Number(e.target.value))}
              disabled={halfAngleDeg === "auto"}
              style={{ flex: 1, padding: 10, borderRadius: 10 }}
            />
          </div>
        </div>

        {/* Envelope controls */}
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Time-aware Envelope (core / fringe / residual)</b>

          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" checked={showEnvelope} onChange={(e) => setShowEnvelope(e.target.checked)} />
            Show envelope polygons
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, opacity: showEnvelope ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={showTimeBands}
              disabled={!showEnvelope}
              onChange={(e) => setShowTimeBands(e.target.checked)}
            />
            Show time bands (residual outlines)
          </label>

          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {[15, 30, 60, 120, 240].map((m) => (
              <button
                key={m}
                onClick={() => {
                  setBandSet((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  fontWeight: bandSet.includes(m) ? 700 : 500,
                  opacity: showEnvelope && showTimeBands ? 1 : 0.5,
                }}
                disabled={!showEnvelope || !showTimeBands}
              >
                {m}m
              </button>
            ))}
          </div>

          {envelopeNow && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.4 }}>
              <b>Confidence:</b> {envelopeNow.confidence_score} ({envelopeNow.confidence_band})
              <div style={{ marginTop: 6 }}>
                <b>Reset:</b> {envelopeNow.reset_recommendation_minutes} min
              </div>
              <div style={{ marginTop: 6 }}>
                <b>Notes:</b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {envelopeNow.deployment_notes.slice(0, 4).map((n: string, i: number) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowAdvanced((p) => !p)}
            style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 10 }}
          >
            {showAdvanced ? "Hide advanced conditions" : "Show advanced conditions"}
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  value={tempF}
                  onChange={(e) => setTempF(Number(e.target.value))}
                  style={{ flex: 1, padding: 10, borderRadius: 10 }}
                  placeholder="Temp °F"
                />
                <input
                  type="number"
                  value={rh}
                  onChange={(e) => setRh(Number(e.target.value))}
                  style={{ flex: 1, padding: 10, borderRadius: 10 }}
                  placeholder="RH %"
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <select value={cloud} onChange={(e) => setCloud(e.target.value as any)} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
                  <option value="clear">Clear</option>
                  <option value="partly">Partly</option>
                  <option value="overcast">Overcast</option>
                  <option value="night">Night</option>
                </select>

                <select value={precip} onChange={(e) => setPrecip(e.target.value as any)} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
                  <option value="none">No precip</option>
                  <option value="light">Light</option>
                  <option value="moderate">Moderate</option>
                  <option value="heavy">Heavy</option>
                </select>
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={recentRain} onChange={(e) => setRecentRain(e.target.checked)} />
                Recent rain ended (conservative)
              </label>

              <div style={{ display: "flex", gap: 8 }}>
                <select value={terrain} onChange={(e) => setTerrain(e.target.value as any)} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
                  <option value="mixed">Mixed</option>
                  <option value="open">Open</option>
                  <option value="forest">Forest</option>
                  <option value="urban">Urban</option>
                  <option value="swamp">Swamp/Brush</option>
                  <option value="beach">Beach/Sand</option>
                </select>

                <select value={stability} onChange={(e) => setStability(e.target.value as any)} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
                  <option value="neutral">Neutral</option>
                  <option value="stable">Stable (night/overcast)</option>
                  <option value="convective">Convective (sunny)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Traps */}
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Terrain Traps</b>

          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={() => setMapMode("setSource")}
              style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: mapMode === "setSource" ? 700 : 500 }}
            >
              Set point
            </button>
            <button
              onClick={() => setMapMode("addTrap")}
              style={{ flex: 1, padding: 10, borderRadius: 10, fontWeight: mapMode === "addTrap" ? 700 : 500 }}
            >
              Add trap
            </button>
          </div>

          {mapMode === "addTrap" && (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <input
                value={newTrapLabel}
                onChange={(e) => setNewTrapLabel(e.target.value)}
                style={{ padding: 10, borderRadius: 10 }}
                placeholder="Trap label"
              />
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Click on the map to place a trap.
              </div>
            </div>
          )}

          {traps.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {traps.slice(0, 6).map((t) => (
                <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <div style={{ flex: 1 }}>{t.label}</div>
                  <button
                    onClick={() => setTraps((prev) => prev.filter((x) => x.id !== t.id))}
                    style={{ padding: "6px 10px", borderRadius: 10 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Export */}
        <button
          onClick={exportPNG}
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12, fontWeight: 700 }}
        >
          Export PNG (Map + Cone + Footer)
        </button>

        {/* Quick status */}
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
          {selectedLL ? `lat: ${selectedLL.lat}\nlon: ${selectedLL.lon}\n` : "lat: (none)\nlon: (none)\n"}
          {effectiveWind
            ? `wind_from_deg: ${effectiveWind.wind_dir_from_deg}\nwind_speed_mps: ${effectiveWind.wind_speed_mps}\n`
            : "wind: (not fetched yet)\n"}
          {appMode === "scenario" ? `lkp_time: ${scenarioLkpISO}\nelapsed_min: ${scenarioElapsedMin}\n` : `now: ${nowISO}\n`}
        </div>
      </div>
    </div>
  );
}
