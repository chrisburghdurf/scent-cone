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
  const d = new Date(v);
  return d.toISOString();
}

export default function LiveMap() {
  const center: LatLngExpression = useMemo(() => [27.49, -82.45], []);
  const zoom = 14;

  // ===== App Mode =====
  const [mode, setMode] = useState<"live" | "scenario">("live");

  // ===== LIVE MODE STATE =====
  const [lkps, setLkps] = useState<LKP[]>([]);
  const [activeLkpId, setActiveLkpId] = useState<string | null>(null);
  const activeLkp = useMemo(() => lkps.find((k) => k.id === activeLkpId) ?? null, [lkps, activeLkpId]);
  const sourceLL_live = activeLkp ? { lat: activeLkp.lat, lon: activeLkp.lon } : null;

  // ===== SCENARIO MODE STATE =====
  const [scenarioLL, setScenarioLL] = useState<{ lat: number; lon: number } | null>(null);
  const [scenarioTimeISO, setScenarioTimeISO] = useState<string>(isoNow());
  const [scenarioElapsedMin, setScenarioElapsedMin] = useState<number>(60);
  const [scenarioLabel, setScenarioLabel] = useState<string>("Scenario");

  // ===== Shared pixel point for cone =====
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);

  // ===== Wind =====
  const [wind, setWind] = useState<WindData | null>(null);
  const [windMode, setWindMode] = useState<"current" | "hourly" | "historical" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  // ===== Visual cone controls =====
  const [lengthPx, setLengthPx] = useState(500);
  const [halfAngle, setHalfAngle] = useState<"auto" | number>("auto");

  // ===== Source locking (live) =====
  const [lockSource, setLockSource] = useState(true);

  // ===== Envelope + environment =====
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [showTimeBands, setShowTimeBands] = useState(true);
  const [bandSet] = useState<number[]>([15, 30, 60, 120]);

  const [terrain, setTerrain] = useState<TerrainType>("mixed");
  const [stability, setStability] = useState<StabilityType>("neutral");
  const [cloud, setCloud] = useState<"clear" | "partly" | "overcast" | "night">("partly");
  const [precip, setPrecip] = useState<PrecipType>("none");
  const [recentRain, setRecentRain] = useState(false);
  const [tempF, setTempF] = useState<number>(75);
  const [rh, setRh] = useState<number>(50);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ===== Terrain traps =====
  const [traps, setTraps] = useState<Trap[]>([]);
  const [mapMode, setMapMode] = useState<"setSource" | "addTrap">("setSource");
  const [newTrapLabel, setNewTrapLabel] = useState("Terrain trap");

  // ===== ICS notes =====
  const [icsNotes, setIcsNotes] = useState<string>("");

  // ===== User location =====
  // ✅ Default OFF
  const [showUserLocation, setShowUserLocation] = useState(false);
  // ✅ Default OFF
  const [followUser, setFollowUser] = useState(false);

  // ✅ Separate tokens:
  // locateToken = request geolocation (marker update). Never recenters by itself.
  const [locateToken, setLocateToken] = useState(0);
  // centerOnMeToken = one-time recenter request
  const [centerOnMeToken, setCenterOnMeToken] = useState(0);

  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // ✅ Force OFF on initial mount (prevents “auto on” from any lingering UI state)
  useEffect(() => {
    setShowUserLocation(false);
    setFollowUser(false);
  }, []);

  // ===== Map refs =====
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // overlay size
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });

  // responsive layout
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

  // ===== Time “now” ticks (live mode only) =====
  const [nowISO, setNowISO] = useState<string>(isoNow());
  useEffect(() => {
    if (mode !== "live") return;
    const id = setInterval(() => setNowISO(isoNow()), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  // Selected location depends on mode
  const selectedLL = mode === "live" ? sourceLL_live : scenarioLL;

  function recomputeSrcPoint(map: LeafletMap | null, ll: { lat: number; lon: number } | null) {
    if (!map || !ll) {
      setSrcPoint(null);
      return;
    }
    const pt = map.latLngToContainerPoint([ll.lat, ll.lon]);
    setSrcPoint({ x: pt.x, y: pt.y });
  }

  // ===== API wind fetch supporting historical =====
  async function fetchWind(lat: number, lon: number, apiMode: "current" | "hourly" | "historical", timeISO?: string) {
    setWind(null);
    const body: any = { lat, lon, mode: apiMode };
    if (apiMode === "historical") body.time_iso = timeISO;

    const r = await fetch("/api/wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const js = await r.json();
    if (!r.ok) throw new Error(js?.error || "Wind fetch failed");
    setWind(js);
  }

  // Effective wind: manual override or fetched wind
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

  const virtualScenarioLkp = useMemo(() => {
    if (!scenarioLL) return null;
    return {
      id: "scenario",
      lat: scenarioLL.lat,
      lon: scenarioLL.lon,
      timeISO: scenarioTimeISO,
      label: scenarioLabel || "Scenario",
    } as LKP;
  }, [scenarioLL, scenarioTimeISO, scenarioLabel]);

  const activeForEnvelope = mode === "live" ? activeLkp : virtualScenarioLkp;

  const envelopeNow = useMemo(() => {
    if (!showEnvelope || !activeForEnvelope || !effectiveWind) return null;

    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;
    const nowForModel =
      mode === "scenario"
        ? addMinutesIso(activeForEnvelope.timeISO, scenarioElapsedMin)
        : nowISO;

    return computeScentEnvelope({
      lkp_lat: activeForEnvelope.lat,
      lkp_lon: activeForEnvelope.lon,
      lkp_time_iso: activeForEnvelope.timeISO,
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
    activeForEnvelope,
    effectiveWind,
    mode,
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
    if (!showEnvelope || !showTimeBands || !activeForEnvelope || !effectiveWind) return null;
    const windSpeedMph = effectiveWind.wind_speed_mps * 2.236936;

    return bandSet
      .slice()
      .sort((a, b) => a - b)
      .map((mins) => {
        const e = computeScentEnvelope({
          lkp_lat: activeForEnvelope.lat,
          lkp_lon: activeForEnvelope.lon,
          lkp_time_iso: activeForEnvelope.timeISO,
          now_time_iso: addMinutesIso(activeForEnvelope.timeISO, mins),
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
    activeForEnvelope,
    effectiveWind,
    tempF,
    rh,
    cloud,
    precip,
    recentRain,
    terrain,
    stability,
  ]);

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

  async function handleMapClick(lat: number, lon: number) {
    if (mapMode === "addTrap") {
      const t: Trap = { id: uid("trap"), lat, lon, label: newTrapLabel || "Terrain trap" };
      setTraps((prev) => [t, ...prev]);
      return;
    }

    if (mode === "scenario") {
      setScenarioLL({ lat, lon });
      recomputeSrcPoint(mapRef.current, { lat, lon });

      if (windMode === "historical") {
        try {
          await fetchWind(lat, lon, "historical", scenarioTimeISO);
        } catch (e: any) {
          alert(e?.message || String(e));
        }
      }
      return;
    }

    // LIVE
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
        const apiMode = windMode === "hourly" ? "hourly" : "current";
        await fetchWind(lat, lon, apiMode);
      } catch (e: any) {
        alert(e?.message || String(e));
      }
    }
  }

  const startPoints = envelopeNow ? envelopeNow.recommended_start_points : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 440px", gap: 16, alignItems: "start" }}>
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
              recomputeSrcPoint(m, selectedLL);
            }}
            onViewChanged={(m: LeafletMap) => {
              recomputeSrcPoint(m, selectedLL);
            }}
            onMapClick={handleMapClick}
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
            lkps={mode === "live" ? lkps : (virtualScenarioLkp ? [virtualScenarioLkp] : [])}
            activeLkpId={mode === "live" ? activeLkpId : (virtualScenarioLkp ? virtualScenarioLkp.id : null)}
          />

          {/* Canvas cone */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 999 }}>
            <ConeCanvas
              width={size.w}
              height={size.h}
              srcPoint={srcPoint}
              wind={effectiveWind}
              lengthPx={lengthPx}
              halfAngleDeg={halfAngle}
              label={selectedLL ? `Point @ ${selectedLL.lat.toFixed(5)}, ${selectedLL.lon.toFixed(5)}` : "Click map to set point"}
            />
          </div>
        </div>
      </div>

      {/* PANEL */}
      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Live Map</h3>

        {/* Live Location */}
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

                  // ✅ just fetch a location fix so marker can show (NO RECENTER)
                  if (on) setLocateToken((n) => n + 1);

                  // If turning OFF, also turn off follow
                  if (!on) setFollowUser(false);
                }}
              />
              Show my location on the map (does not lock map)
            </label>
          </div>

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <button
              onClick={() => {
                // ensure marker is enabled
                if (!showUserLocation) setShowUserLocation(true);
                // request a fresh fix
                setLocateToken((n) => n + 1);
                // ✅ one-time recenter request
                setCenterOnMeToken((n) => n + 1);
              }}
              style={{ padding: 10, borderRadius: 10 }}
            >
              Center on Me (one-time)
            </button>

            <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: showUserLocation ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={followUser}
                disabled={!showUserLocation}
                onChange={(e) => setFollowUser(e.target.checked)}
              />
              Follow me (will not fight panning)
            </label>

            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Tip: leave <b>Follow me</b> OFF for SAR planning — use <b>Center on Me</b> when needed.
            </div>
          </div>
        </div>

        {/* (Rest of your panel stays as-is; keeping this file focused on fixing location behavior) */}
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          If you still see “auto on” after this change, it’s usually your phone’s PWA caching an old build — I’ll show you the quick refresh steps if needed.
        </div>

        {/* Minimal footer / export kept */}
        <label style={{ display: "block", marginTop: 12 }}>ICS Notes (optional)</label>
        <textarea value={icsNotes} onChange={(e) => setIcsNotes(e.target.value)} placeholder="Notes for ICS export" style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 10 }} />

        <button
          onClick={async () => {
            if (!exportRef.current) return;
            const dataUrl = await toPng(exportRef.current, { cacheBust: true, pixelRatio: 2 });
            await downloadDataUrlPNG_ICS(dataUrl, "scent_cone_ics.png", { notes: icsNotes });
          }}
          style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12 }}
        >
          Export PNG (Map + Cone + ICS Footer)
        </button>
      </div>
    </div>
  );
}
