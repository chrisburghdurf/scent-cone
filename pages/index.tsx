import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import { toPng } from "html-to-image";
import { buildSessionGeoJson, downloadJson } from "@/lib/export";
import {
  buildConeDistanceBands,
  buildConePolygon,
  computeTrackMetrics,
  haversineMeters,
  nearestPointForPlayback,
  windFromToDeg,
} from "@/lib/geo";
import { buildGpx, downloadText, parseGpx } from "@/lib/gpx";
import { fetchPoolingOverlay } from "@/lib/pooling";
import { openPdfReportWindow } from "@/lib/report";
import {
  loadHandlerProfiles,
  loadLaidTrackLibrary,
  loadK9Profiles,
  loadSessions,
  saveHandlerProfiles,
  saveLaidTrackLibrary,
  saveK9Profiles,
  saveSessions,
} from "@/lib/storage";
import {
  ConeSettings,
  DrawTarget,
  HandlerProfile,
  K9Profile,
  LatLng,
  Mode,
  PointSample,
  PoolingResult,
  PoolingSensitivity,
  SavedTrack,
  SessionRecord,
  WeatherSnapshot,
} from "@/lib/types";
import { fetchWeather } from "@/lib/weather";

const PlannerMap = dynamic(() => import("@/components/PlannerMap"), { ssr: false });

const DEFAULT_LKP: LatLng = { lat: 39.5, lng: -104.99 };
const LIVE_REFRESH_MS = 10 * 60 * 1000;

const DEFAULT_CONE: ConeSettings = {
  timeHorizonHours: 2,
  spreadDeg: 46,
  stability: "medium",
};

function kmhToMph(v: number): number {
  return v * 0.621371;
}

function mphToKmh(v: number): number {
  return v / 0.621371;
}

function cToF(v: number): number {
  return (v * 9) / 5 + 32;
}

function fToC(v: number): number {
  return ((v - 32) * 5) / 9;
}

function nowIsoRounded() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`;
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("live");
  const [lkp, setLkp] = useState<LatLng>(DEFAULT_LKP);
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_LKP);
  const [lkpLocked, setLkpLocked] = useState(true);
  const [canPlaceLkp, setCanPlaceLkp] = useState(false);
  const [hasLkp, setHasLkp] = useState(true);
  const [requestedTime, setRequestedTime] = useState<string>(nowIsoRounded());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherError, setWeatherError] = useState<string>("");
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);

  const [useManualOverride, setUseManualOverride] = useState(false);
  const [manualWindSpeed, setManualWindSpeed] = useState(8);
  const [manualWindFrom, setManualWindFrom] = useState(270);
  const [manualTemp, setManualTemp] = useState(61);
  const [manualDew, setManualDew] = useState(43);

  const [coneSettings, setConeSettings] = useState<ConeSettings>(DEFAULT_CONE);

  const [showCone, setShowCone] = useState(true);
  const [showLkp, setShowLkp] = useState(true);
  const [showLaidTrack, setShowLaidTrack] = useState(true);
  const [showDogTrack, setShowDogTrack] = useState(true);
  const [showPooling, setShowPooling] = useState(false);

  const [poolingSensitivity, setPoolingSensitivity] = useState<PoolingSensitivity>("medium");
  const [poolingResult, setPoolingResult] = useState<PoolingResult | null>(null);
  const [poolingError, setPoolingError] = useState("");
  const [mapZoom, setMapZoom] = useState(12);

  const [drawTarget, setDrawTarget] = useState<DrawTarget>("none");
  const [laidTrack, setLaidTrack] = useState<PointSample[]>([]);
  const [dogTrack, setDogTrack] = useState<PointSample[]>([]);
  const [laidTrackLibrary, setLaidTrackLibrary] = useState<SavedTrack[]>([]);
  const [selectedLaidTrackId, setSelectedLaidTrackId] = useState("");
  const [isRecordingLaidTrack, setIsRecordingLaidTrack] = useState(false);
  const [recordingTrackName, setRecordingTrackName] = useState("");
  const [trackRecordingError, setTrackRecordingError] = useState("");
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [followMeEnabled, setFollowMeEnabled] = useState(false);

  const [sessionName, setSessionName] = useState("Training Session");
  const [laidTrackTime, setLaidTrackTime] = useState(nowIsoRounded());
  const [runTime, setRunTime] = useState(nowIsoRounded());
  const [sessionNotes, setSessionNotes] = useState("");

  const [k9Profiles, setK9Profiles] = useState<K9Profile[]>([]);
  const [handlerProfiles, setHandlerProfiles] = useState<HandlerProfile[]>([]);
  const [selectedK9Id, setSelectedK9Id] = useState("");
  const [selectedHandlerId, setSelectedHandlerId] = useState("");

  const [newK9Name, setNewK9Name] = useState("");
  const [newK9Breed, setNewK9Breed] = useState("");
  const [newHandlerName, setNewHandlerName] = useState("");
  const [newHandlerAgency, setNewHandlerAgency] = useState("");

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [filterK9, setFilterK9] = useState("");
  const [filterHandler, setFilterHandler] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const laidTrackFileInputRef = useRef<HTMLInputElement | null>(null);
  const dogTrackFileInputRef = useRef<HTMLInputElement | null>(null);
  const mapPanelRef = useRef<HTMLElement | null>(null);
  const laidTrackWatchIdRef = useRef<number | null>(null);
  const followMeWatchIdRef = useRef<number | null>(null);
  const [didInitFromDevice, setDidInitFromDevice] = useState(false);

  useEffect(() => {
    setK9Profiles(loadK9Profiles());
    setHandlerProfiles(loadHandlerProfiles());
    setSessions(loadSessions());
    setLaidTrackLibrary(loadLaidTrackLibrary());
  }, []);

  useEffect(() => {
    if (didInitFromDevice) return;
    if (typeof window === "undefined") return;

    setRequestedTime(nowIsoRounded());

    if (!("geolocation" in navigator)) {
      setDidInitFromDevice(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setLkp(current);
        setMapCenter(current);
        setUserLocation(current);
        setHasLkp(true);
        setLkpLocked(true);
        setDidInitFromDevice(true);
      },
      () => {
        setDidInitFromDevice(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }, [didInitFromDevice]);

  useEffect(
    () => () => {
      if (laidTrackWatchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(laidTrackWatchIdRef.current);
        laidTrackWatchIdRef.current = null;
      }
      if (followMeWatchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(followMeWatchIdRef.current);
        followMeWatchIdRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (mode === "historical") return;
    if (laidTrackWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(laidTrackWatchIdRef.current);
      laidTrackWatchIdRef.current = null;
    }
    setIsRecordingLaidTrack(false);
  }, [mode]);

  useEffect(() => {
    if (!followMeEnabled) {
      if (followMeWatchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(followMeWatchIdRef.current);
        followMeWatchIdRef.current = null;
      }
      return;
    }

    if (!("geolocation" in navigator)) return;

    followMeWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(current);
        setMapCenter(current);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );

    return () => {
      if (followMeWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(followMeWatchIdRef.current);
        followMeWatchIdRef.current = null;
      }
    };
  }, [followMeEnabled]);

  const fetchWeatherNow = useCallback(async () => {
    if (!lkp) return;
    try {
      setIsFetchingWeather(true);
      setWeatherError("");
      const reqTime = mode === "live" ? new Date().toISOString() : new Date(requestedTime).toISOString();
      const data = await fetchWeather(mode, lkp.lat, lkp.lng, reqTime);
      setWeather(data);
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : "Weather unavailable");
    } finally {
      setIsFetchingWeather(false);
    }
  }, [lkp, mode, requestedTime]);

  useEffect(() => {
    void fetchWeatherNow();
  }, [fetchWeatherNow]);

  useEffect(() => {
    if (mode !== "live") return;
    const timer = window.setInterval(() => {
      if (!useManualOverride) void fetchWeatherNow();
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [mode, useManualOverride, fetchWeatherNow]);

  const weatherWindMph = weather ? kmhToMph(weather.windSpeed) : manualWindSpeed;
  const effectiveWindMph = useManualOverride ? manualWindSpeed : weatherWindMph;
  const effectiveWindSpeed = mphToKmh(effectiveWindMph);
  const effectiveWindFrom = useManualOverride ? manualWindFrom : weather?.windFromDeg ?? manualWindFrom;
  const weatherTempF = weather ? cToF(weather.temperatureC) : manualTemp;
  const weatherDewF = weather ? cToF(weather.dewPointC) : manualDew;
  const effectiveTemp = useManualOverride ? manualTemp : weatherTempF;
  const effectiveDew = useManualOverride ? manualDew : weatherDewF;

  const conePolygon = useMemo(
    () => buildConePolygon(lkp, effectiveWindFrom, effectiveWindSpeed, coneSettings),
    [lkp, effectiveWindFrom, effectiveWindSpeed, coneSettings],
  );
  const coneBands = useMemo(
    () => buildConeDistanceBands(lkp, effectiveWindFrom, effectiveWindSpeed, coneSettings, [15, 30, 60]),
    [lkp, effectiveWindFrom, effectiveWindSpeed, coneSettings],
  );
  const activeConePolygon = useMemo(() => (hasLkp ? conePolygon : []), [hasLkp, conePolygon]);
  const activeConeBands = useMemo(() => (hasLkp ? coneBands : []), [hasLkp, coneBands]);

  const poolingRadiusKm = useMemo(
    () => Math.max(1, Math.min(8, coneSettings.timeHorizonHours * (effectiveWindSpeed / 10) + mapZoom / 8)),
    [coneSettings.timeHorizonHours, effectiveWindSpeed, mapZoom],
  );

  useEffect(() => {
    if (!showPooling) {
      setPoolingResult(null);
      return;
    }

    let active = true;
    (async () => {
      try {
        setPoolingError("");
        const result = await fetchPoolingOverlay(
          lkp,
          windFromToDeg(effectiveWindFrom),
          poolingRadiusKm,
          poolingSensitivity,
        );
        if (active) setPoolingResult(result);
      } catch (error) {
        if (active) {
          setPoolingError(error instanceof Error ? error.message : "Pooling unavailable");
          setPoolingResult(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [showPooling, lkp, effectiveWindFrom, poolingSensitivity, poolingRadiusKm]);

  const metrics = useMemo(
    () => computeTrackMetrics(laidTrack, dogTrack, activeConePolygon),
    [laidTrack, dogTrack, activeConePolygon],
  );

  const playbackLaidMarker = useMemo(() => nearestPointForPlayback(laidTrack, playbackProgress), [laidTrack, playbackProgress]);
  const playbackDogMarker = useMemo(() => nearestPointForPlayback(dogTrack, playbackProgress), [dogTrack, playbackProgress]);

  function addK9() {
    const name = newK9Name.trim();
    if (!name) return;
    const profile: K9Profile = { id: uid("k9"), name, breed: newK9Breed.trim() || undefined };
    const next = [...k9Profiles, profile];
    setK9Profiles(next);
    saveK9Profiles(next);
    setSelectedK9Id(profile.id);
    setNewK9Name("");
    setNewK9Breed("");
  }

  function addHandler() {
    const name = newHandlerName.trim();
    if (!name) return;
    const profile: HandlerProfile = {
      id: uid("handler"),
      name,
      agency: newHandlerAgency.trim() || undefined,
    };
    const next = [...handlerProfiles, profile];
    setHandlerProfiles(next);
    saveHandlerProfiles(next);
    setSelectedHandlerId(profile.id);
    setNewHandlerName("");
    setNewHandlerAgency("");
  }

  function retireK9(id: string) {
    const next = k9Profiles.map((p) => (p.id === id ? { ...p, retired: !p.retired } : p));
    setK9Profiles(next);
    saveK9Profiles(next);
  }

  function retireHandler(id: string) {
    const next = handlerProfiles.map((p) => (p.id === id ? { ...p, retired: !p.retired } : p));
    setHandlerProfiles(next);
    saveHandlerProfiles(next);
  }

  function handleSetLkpFromMap(point: LatLng) {
    if (!canPlaceLkp && lkpLocked) return;
    setLkp(point);
    setMapCenter(point);
    setHasLkp(true);
    setLkpLocked(true);
    setCanPlaceLkp(false);
  }

  function armAdditionalLkpPlacement() {
    setCanPlaceLkp(true);
  }

  function resetLkp() {
    setHasLkp(false);
    setLkpLocked(false);
    setCanPlaceLkp(true);
  }

  function centerOnCurrentLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMapCenter(current);
        setUserLocation(current);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }

  function addTrackPoint(target: "laid" | "dog", point: LatLng) {
    const stamped = { ...point, ts: new Date().toISOString() };
    if (target === "laid") setLaidTrack((prev) => [...prev, stamped]);
    else setDogTrack((prev) => [...prev, stamped]);
  }

  function upsertLaidTrackLibrary(track: SavedTrack) {
    const next = [track, ...laidTrackLibrary.filter((t) => t.id !== track.id)];
    setLaidTrackLibrary(next);
    saveLaidTrackLibrary(next);
    setSelectedLaidTrackId(track.id);
  }

  function saveCurrentLaidTrackToLibrary() {
    if (laidTrack.length < 2) {
      alert("Need at least two points to save a laid track.");
      return;
    }
    const track: SavedTrack = {
      id: uid("laid"),
      name: recordingTrackName.trim() || `Laid Track ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      points: laidTrack,
    };
    upsertLaidTrackLibrary(track);
  }

  function startLaidTrackRecording() {
    if (!("geolocation" in navigator)) {
      setTrackRecordingError("Geolocation not available on this device.");
      return;
    }
    if (isRecordingLaidTrack) return;

    setTrackRecordingError("");
    setDrawTarget("none");
    setLaidTrack([]);
    setSelectedLaidTrackId("");
    if (!recordingTrackName.trim()) {
      setRecordingTrackName(`Laid Track ${new Date().toLocaleString()}`);
    }

    setIsRecordingLaidTrack(true);
    laidTrackWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: PointSample = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: new Date(pos.timestamp).toISOString(),
          speedKmh: Number.isFinite(pos.coords.speed ?? NaN) ? (pos.coords.speed as number) * 3.6 : 0,
        };

        setLaidTrack((prev) => {
          if (!prev.length) return [point];
          const last = prev[prev.length - 1];
          const dist = haversineMeters(last, point);
          if (dist < 1.5) return prev;
          return [...prev, point];
        });
      },
      (error) => {
        setTrackRecordingError(`Track recording error: ${error.message}`);
        setIsRecordingLaidTrack(false);
        if (laidTrackWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(laidTrackWatchIdRef.current);
          laidTrackWatchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  }

  function stopLaidTrackRecording() {
    if (laidTrackWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(laidTrackWatchIdRef.current);
      laidTrackWatchIdRef.current = null;
    }
    setIsRecordingLaidTrack(false);

    if (laidTrack.length >= 2) {
      const track: SavedTrack = {
        id: uid("laid"),
        name: recordingTrackName.trim() || `Laid Track ${new Date().toLocaleString()}`,
        createdAt: new Date().toISOString(),
        points: laidTrack,
      };
      upsertLaidTrackLibrary(track);
    }
  }

  function selectLaidTrack(trackId: string) {
    setSelectedLaidTrackId(trackId);
    const selected = laidTrackLibrary.find((t) => t.id === trackId);
    if (selected) {
      setLaidTrack(selected.points);
      setRecordingTrackName(selected.name);
    }
  }

  function clearTracks() {
    setLaidTrack([]);
    setDogTrack([]);
  }

  function buildSessionRecord(): SessionRecord {
    const k9 = k9Profiles.find((p) => p.id === selectedK9Id);
    const handler = handlerProfiles.find((p) => p.id === selectedHandlerId);

    return {
      id: uid("session"),
      name: sessionName,
      mode,
      createdAt: new Date().toISOString(),
      lkp,
      requestedTime: mode === "live" ? new Date().toISOString() : new Date(requestedTime).toISOString(),
      weather,
      coneSettings,
      useManualOverride,
      manualWindSpeed,
      manualWindFromDeg: manualWindFrom,
      manualTempC: fToC(manualTemp),
      manualDewPointC: fToC(manualDew),
      scentPoolingEnabled: showPooling,
      scentPoolingSensitivity: poolingSensitivity,
      terrainDataSource: poolingResult?.source ?? "N/A",
      laidTrack,
      dogTrack,
      laidTrackTime: laidTrackTime ? new Date(laidTrackTime).toISOString() : undefined,
      runTime: runTime ? new Date(runTime).toISOString() : undefined,
      k9Id: k9?.id,
      k9Name: k9?.name,
      handlerId: handler?.id,
      handlerName: handler?.name,
      notes: sessionNotes,
    };
  }

  function saveSession() {
    if (mode === "historical" && (!selectedK9Id || !selectedHandlerId)) {
      alert("Historical/Training sessions require K9 and Handler selection.");
      return;
    }

    const record = buildSessionRecord();
    const next = [record, ...sessions];
    setSessions(next);
    saveSessions(next);
  }

  function loadSession(session: SessionRecord) {
    setMode(session.mode);
    setLkp(session.lkp);
    setRequestedTime(new Date(session.requestedTime).toISOString().slice(0, 16));
    setWeather(session.weather);
    setConeSettings(session.coneSettings);
    setUseManualOverride(session.useManualOverride);
    setManualWindSpeed(session.manualWindSpeed ?? manualWindSpeed);
    setManualWindFrom(session.manualWindFromDeg ?? manualWindFrom);
    setManualTemp(session.manualTempC !== undefined ? cToF(session.manualTempC) : manualTemp);
    setManualDew(session.manualDewPointC !== undefined ? cToF(session.manualDewPointC) : manualDew);
    setShowPooling(session.scentPoolingEnabled);
    setPoolingSensitivity(session.scentPoolingSensitivity);
    setLaidTrack(session.laidTrack ?? []);
    setSelectedLaidTrackId("");
    setDogTrack(session.dogTrack ?? []);
    setSessionName(session.name);
    setSessionNotes(session.notes ?? "");
    setLaidTrackTime(session.laidTrackTime ? session.laidTrackTime.slice(0, 16) : nowIsoRounded());
    setRunTime(session.runTime ? session.runTime.slice(0, 16) : nowIsoRounded());
    setSelectedK9Id(session.k9Id ?? "");
    setSelectedHandlerId(session.handlerId ?? "");
  }

  function exportGeoJson() {
    const session = buildSessionRecord();
    const geo = buildSessionGeoJson(session, activeConePolygon);
    downloadJson(`${session.id}.geojson`, geo);
  }

  function exportTrackGpx(kind: "laid" | "dog") {
    const points = kind === "laid" ? laidTrack : dogTrack;
    const gpx = buildGpx(`${sessionName}-${kind}-track`, points);
    downloadText(`${sessionName}-${kind}.gpx`, gpx, "application/gpx+xml");
  }

  async function importTrackGpx(kind: "laid" | "dog", file: File) {
    const content = await file.text();
    const points = parseGpx(content);
    if (!points.length) {
      alert("No track points found in GPX.");
      return;
    }
    if (kind === "laid") {
      setLaidTrack(points);
      const track: SavedTrack = {
        id: uid("laid"),
        name: file.name.replace(/\.gpx$/i, ""),
        createdAt: new Date().toISOString(),
        points,
      };
      upsertLaidTrackLibrary(track);
    } else {
      setDogTrack(points);
    }
  }

  async function exportPdfReport() {
    if (!mapPanelRef.current) {
      alert("Map panel is not ready for snapshot.");
      return;
    }
    try {
      const mapImageDataUrl = await toPng(mapPanelRef.current, {
        cacheBust: true,
        pixelRatio: 2,
      });
      openPdfReportWindow({
        session: buildSessionRecord(),
        metrics,
        mapImageDataUrl,
      });
    } catch {
      alert("Failed to capture map snapshot for PDF report.");
    }
  }

  async function shareSessionSummary() {
    const session = buildSessionRecord();
    const text = `SAR Scent Planner session: ${session.name} | Mode: ${session.mode.toUpperCase()} | LKP: ${session.lkp.lat.toFixed(5)}, ${session.lkp.lng.toFixed(5)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "SAR Scent Planner Session",
          text,
          url: window.location.href,
        });
      } catch {
        // user canceled share dialog
      }
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
    alert("Session summary copied to clipboard.");
  }

  const filteredSessions = sessions.filter((s) => {
    if (filterK9 && s.k9Id !== filterK9) return false;
    if (filterHandler && s.handlerId !== filterHandler) return false;
    if (filterStartDate && new Date(s.createdAt) < new Date(filterStartDate)) return false;
    if (filterEndDate && new Date(s.createdAt) > new Date(`${filterEndDate}T23:59:59`)) return false;
    return true;
  });

  const modeLabel =
    mode === "live" ? "LIVE weather" : mode === "historical" ? "HISTORICAL weather" : "FORECAST weather";

  return (
    <>
      <Head>
        <title>SAR Scent Planner</title>
        <meta
          name="description"
          content="Search and Rescue/K9 scent cone and pooling planning tool for live, historical training, and forecast workflows."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="app-shell">
        <section className="map-stage">
          <section className="map-panel" ref={mapPanelRef}>
            <div className="map-topbar">
              <div className="map-tabs">
                <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>
                  LIVE
                </button>
                <button className={mode === "historical" ? "active" : ""} onClick={() => setMode("historical")}>
                  HISTORICAL / TRAINING
                </button>
                <button className={mode === "forecast" ? "active" : ""} onClick={() => setMode("forecast")}>
                  FORECAST
                </button>
              </div>
              <button className="menu-toggle map-menu-toggle" onClick={() => setMenuOpen((prev) => !prev)}>
                {menuOpen ? "Close Menu" : "Open Menu"}
              </button>
            </div>

            {menuOpen ? (
              <div className="map-quick-menu">
                <div className="quick-menu-head">
                  <h3>Map Quick Menu</h3>
                  <button className="quick-close-btn" onClick={() => setMenuOpen(false)}>
                    Close Menu
                  </button>
                </div>
                <div className="mode-pill">{modeLabel}</div>
                <label className="inline"><input type="checkbox" checked={showCone} onChange={(e) => setShowCone(e.target.checked)} />Scent cone</label>
                <label className="inline"><input type="checkbox" checked={showPooling} onChange={(e) => setShowPooling(e.target.checked)} />Pooling overlay</label>
                <label className="inline"><input type="checkbox" checked={showLaidTrack} onChange={(e) => setShowLaidTrack(e.target.checked)} />Laid track</label>
                <label className="inline"><input type="checkbox" checked={showDogTrack} onChange={(e) => setShowDogTrack(e.target.checked)} />Dog path</label>
                <label className="inline"><input type="checkbox" checked={showLkp} onChange={(e) => setShowLkp(e.target.checked)} />LKP marker</label>
                <button onClick={() => void fetchWeatherNow()} disabled={isFetchingWeather}>
                  {isFetchingWeather ? "Refreshing..." : "Refresh Weather"}
                </button>
              </div>
            ) : null}

            <PlannerMap
              lkp={lkp}
              windSpeedMph={effectiveWindMph}
              mapCenter={mapCenter}
              canPlaceLkp={canPlaceLkp || !lkpLocked}
              userLocation={userLocation}
              onSetLkp={handleSetLkpFromMap}
              conePolygon={activeConePolygon}
              coneBands={activeConeBands}
              poolingCells={poolingResult?.cells ?? []}
              laidTrack={laidTrack}
              dogTrack={dogTrack}
              drawTarget={mode === "historical" ? drawTarget : "none"}
              onAddTrackPoint={addTrackPoint}
              showCone={showCone && hasLkp}
              showPooling={showPooling}
              showLaidTrack={showLaidTrack}
              showDogTrack={showDogTrack}
              showLkp={showLkp && hasLkp}
              playbackLaidMarker={playbackLaidMarker}
              playbackDogMarker={playbackDogMarker}
              onViewportChange={setMapZoom}
            />
          </section>
        </section>

        <section className="control-panel">
          <h1>SAR Scent Planner</h1>
          <p className="muted">Map-first field and training planning for K9 handlers and incident personnel.</p>

          <div className="card">
            <h2>Mode + Time</h2>
            <p className="status">Active mode: {modeLabel}</p>
            <button onClick={() => void fetchWeatherNow()} disabled={isFetchingWeather}>
              {isFetchingWeather ? "Refreshing..." : "Refresh Weather"}
            </button>
            {weather ? <div className="meta-grid"><div>Last updated: {new Date(weather.lastUpdated).toLocaleString()}</div></div> : null}
            {weatherError ? (
              <div className="warning">
                Weather unavailable—using manual inputs.
                <br />
                {weatherError}
              </div>
            ) : null}
          </div>

          {mode !== "live" ? (
            <div className="card">
              <h2>Requested Time</h2>
              <label>
                Date/time
                <input
                  type="datetime-local"
                  value={requestedTime}
                  onChange={(e) => setRequestedTime(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="card">
            <h2>LKP</h2>
            <p className="muted">LKP lock prevents accidental movement. Use Add Additional LKP or Reset LKP to change it.</p>
            <div className="meta-grid">
              <div>Status: {hasLkp ? (lkpLocked ? "Locked" : "Unlocked") : "Not set"}</div>
              <div>Placement armed: {canPlaceLkp ? "Yes - click map to place LKP" : "No"}</div>
            </div>
            <div className="mode-row">
              <button onClick={armAdditionalLkpPlacement}>Add Additional LKP</button>
              <button onClick={resetLkp}>Reset LKP</button>
              <button onClick={centerOnCurrentLocation}>Current Location (Center Once)</button>
              <button className={followMeEnabled ? "active" : ""} onClick={() => setFollowMeEnabled((v) => !v)}>
                Follow Me: {followMeEnabled ? "ON" : "OFF"}
              </button>
            </div>
            {followMeEnabled ? <p className="muted">Follow-me is active and will keep map centered on your moving location.</p> : null}
          </div>

          <div className="card">
            <h2>Wind Inputs</h2>
            <label className="inline">
              <input
                type="checkbox"
                checked={useManualOverride}
                onChange={(e) => setUseManualOverride(e.target.checked)}
              />
              Manual Override
            </label>
            <p className="muted">Wind direction uses meteorological WIND FROM degrees.</p>
            <label>
              Wind FROM (deg)
              <input type="number" value={manualWindFrom} onChange={(e) => setManualWindFrom(Number(e.target.value))} />
            </label>
            <label>
              Wind speed (mph)
              <input type="number" value={manualWindSpeed} onChange={(e) => setManualWindSpeed(Number(e.target.value))} />
            </label>
            <label>
              Temp deg F
              <input type="number" value={manualTemp} onChange={(e) => setManualTemp(Number(e.target.value))} />
            </label>
            <label>
              Dew point deg F
              <input type="number" value={manualDew} onChange={(e) => setManualDew(Number(e.target.value))} />
            </label>
            <div className="meta-grid">
              <div>Effective wind: {effectiveWindMph.toFixed(1)} mph</div>
              <div>Direction FROM: {Math.round(effectiveWindFrom)} deg</div>
              <div>Temp: {effectiveTemp.toFixed(1)} F</div>
              <div>Dew: {effectiveDew.toFixed(1)} F</div>
            </div>
          </div>

          <div className="card">
            <h2>Cone + Pooling</h2>
            <label>
              Time horizon (hours)
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.5}
                value={coneSettings.timeHorizonHours}
                onChange={(e) =>
                  setConeSettings((prev) => ({ ...prev, timeHorizonHours: Number(e.target.value) }))
                }
              />
              <span>{coneSettings.timeHorizonHours.toFixed(1)} h</span>
            </label>
            <label>
              Spread / confidence
              <input
                type="range"
                min={20}
                max={100}
                step={2}
                value={coneSettings.spreadDeg}
                onChange={(e) => setConeSettings((prev) => ({ ...prev, spreadDeg: Number(e.target.value) }))}
              />
              <span>{coneSettings.spreadDeg} deg</span>
            </label>
            <label>
              Stability / variability
              <select
                value={coneSettings.stability}
                onChange={(e) =>
                  setConeSettings((prev) => ({ ...prev, stability: e.target.value as ConeSettings["stability"] }))
                }
              >
                <option value="low">Low stability (more spread)</option>
                <option value="medium">Medium</option>
                <option value="high">High stability (less spread)</option>
              </select>
            </label>

            <label className="inline">
              <input type="checkbox" checked={showPooling} onChange={(e) => setShowPooling(e.target.checked)} />
              Show Scent Pooling
            </label>
            <label>
              Pooling sensitivity
              <select
                value={poolingSensitivity}
                onChange={(e) => setPoolingSensitivity(e.target.value as PoolingSensitivity)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            {showPooling ? (
              <div className="note">
                Estimated pooling zones
                <br />
                Terrain source: {poolingResult?.source ?? "loading..."}
                <br />
                Timestamp: {poolingResult ? new Date(poolingResult.generatedAt).toLocaleString() : "pending"}
                <br />
                Planning/training estimate—field conditions vary.
              </div>
            ) : null}
            {poolingError ? <div className="warning">Pooling unavailable: {poolingError}</div> : null}
            <div className="note">
              Reasonable scent travel expectations in current cone:
              <br />
              {activeConeBands.map((band) => {
                const miles = band.distanceM / 1609.34;
                return (
                  <span key={`band-text-${band.minutes}`}>
                    {band.minutes} min: {band.distanceM.toFixed(0)} m ({miles.toFixed(2)} mi)
                    <br />
                  </span>
                );
              })}
            </div>
          </div>

          

          <>
              <div className="card">
                <h2>Users + K9 Profiles</h2>
                <label>
                  K9 (required)
                  <select value={selectedK9Id} onChange={(e) => setSelectedK9Id(e.target.value)}>
                    <option value="">Select K9</option>
                    {k9Profiles.filter((p) => !p.retired).map((p) => (
                      <option value={p.id} key={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Handler (required)
                  <select value={selectedHandlerId} onChange={(e) => setSelectedHandlerId(e.target.value)}>
                    <option value="">Select Handler</option>
                    {handlerProfiles.filter((p) => !p.retired).map((p) => (
                      <option value={p.id} key={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>

                <label>New K9 name<input value={newK9Name} onChange={(e) => setNewK9Name(e.target.value)} /></label>
                <label>Breed (optional)<input value={newK9Breed} onChange={(e) => setNewK9Breed(e.target.value)} /></label>
                <button onClick={addK9}>Add K9</button>

                <label>New Handler name<input value={newHandlerName} onChange={(e) => setNewHandlerName(e.target.value)} /></label>
                <label>Agency (optional)<input value={newHandlerAgency} onChange={(e) => setNewHandlerAgency(e.target.value)} /></label>
                <button onClick={addHandler}>Add Handler</button>

                <div className="mini-list">
                  {k9Profiles.map((p) => (
                    <div key={p.id}>{p.name} {p.retired ? "(retired)" : ""} <button onClick={() => retireK9(p.id)}>Toggle retire</button></div>
                  ))}
                  {handlerProfiles.map((p) => (
                    <div key={p.id}>{p.name} {p.retired ? "(retired)" : ""} <button onClick={() => retireHandler(p.id)}>Toggle retire</button></div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h2>Training Session</h2>
                {mode === "historical" ? (
                  <>
                    <p className="muted">Track Builder: record laid tracks with GPS start/stop, and draw dog path manually.</p>
                    <label>
                      Laid track name
                      <input
                        value={recordingTrackName}
                        onChange={(e) => setRecordingTrackName(e.target.value)}
                        placeholder="Example: Urban trailing drill - sector A"
                      />
                    </label>
                    <div className="mode-row">
                      <button onClick={startLaidTrackRecording} disabled={isRecordingLaidTrack}>
                        Start Laying Track
                      </button>
                      <button onClick={stopLaidTrackRecording} disabled={!isRecordingLaidTrack}>
                        Stop Laying Track
                      </button>
                      <button onClick={saveCurrentLaidTrackToLibrary}>Save Current Laid Track</button>
                    </div>
                    {isRecordingLaidTrack ? (
                      <div className="note">Recording laid track... points captured: {laidTrack.length}</div>
                    ) : null}
                    {trackRecordingError ? <div className="warning">{trackRecordingError}</div> : null}
                    <label>
                      Select previously laid track
                      <select value={selectedLaidTrackId} onChange={(e) => selectLaidTrack(e.target.value)}>
                        <option value="">Current / unsaved</option>
                        {laidTrackLibrary.map((track) => (
                          <option key={track.id} value={track.id}>
                            {track.name} ({new Date(track.createdAt).toLocaleDateString()})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mode-row">
                      <button className={drawTarget === "none" ? "active" : ""} onClick={() => setDrawTarget("none")}>
                        Draw OFF / Set LKP
                      </button>
                      <button className={drawTarget === "dog" ? "active" : ""} onClick={() => setDrawTarget("dog")}>
                        Draw Dog Path
                      </button>
                      <button onClick={clearTracks}>Clear Tracks</button>
                    </div>
                    <div className="mode-row">
                      <button onClick={() => laidTrackFileInputRef.current?.click()}>Import Laid GPX</button>
                      <button onClick={() => dogTrackFileInputRef.current?.click()}>Import Dog GPX</button>
                      <button onClick={() => exportTrackGpx("laid")}>Export Laid GPX</button>
                      <button onClick={() => exportTrackGpx("dog")}>Export Dog GPX</button>
                    </div>
                    <input
                      ref={laidTrackFileInputRef}
                      type="file"
                      accept=".gpx,application/gpx+xml,application/xml,text/xml"
                      className="hidden-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importTrackGpx("laid", file);
                        e.currentTarget.value = "";
                      }}
                    />
                    <input
                      ref={dogTrackFileInputRef}
                      type="file"
                      accept=".gpx,application/gpx+xml,application/xml,text/xml"
                      className="hidden-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importTrackGpx("dog", file);
                        e.currentTarget.value = "";
                      }}
                    />
                    <div className="note">
                      Laid track speed legend:
                      <br />
                      Gray = stationary / near stationary, Green = slow walk, Yellow = brisk movement, Orange = faster movement.
                    </div>
                  </>
                ) : null}
                <label>Session name<input value={sessionName} onChange={(e) => setSessionName(e.target.value)} /></label>
                <label>Laid track time<input type="datetime-local" value={laidTrackTime} onChange={(e) => setLaidTrackTime(e.target.value)} /></label>
                <label>Run time<input type="datetime-local" value={runTime} onChange={(e) => setRunTime(e.target.value)} /></label>
                <label>Notes<textarea value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} rows={3} /></label>
                <label>
                  Playback scrubber
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(playbackProgress * 100)}
                    onChange={(e) => setPlaybackProgress(Number(e.target.value) / 100)}
                  />
                </label>
                <div className="meta-grid">
                  <div>Min sep: {metrics.minSeparationM.toFixed(1)} m</div>
                  <div>Avg sep: {metrics.avgSeparationM.toFixed(1)} m</div>
                  <div>Max sep: {metrics.maxSeparationM.toFixed(1)} m</div>
                  <div>Dog in cone: {metrics.dogInsideConePct.toFixed(1)}%</div>
                  <div>Track enter/exit count: {metrics.laidTrackTransitions}</div>
                </div>
              </div>

              <div className="card">
                <h2>Training Log</h2>
                <label>
                  Filter K9
                  <select value={filterK9} onChange={(e) => setFilterK9(e.target.value)}>
                    <option value="">Any</option>
                    {k9Profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Filter Handler
                  <select value={filterHandler} onChange={(e) => setFilterHandler(e.target.value)}>
                    <option value="">Any</option>
                    {handlerProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label>Start date<input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /></label>
                <label>End date<input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /></label>
                <div className="mini-list">
                  {filteredSessions.map((s) => (
                    <div key={s.id}>
                      <button onClick={() => loadSession(s)}>
                        {s.name} | {s.k9Name ?? "No K9"} / {s.handlerName ?? "No Handler"} | {new Date(s.createdAt).toLocaleDateString()}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>

          <div className="card">
            <h2>Download + Share</h2>
            <button onClick={saveSession}>Save Session</button>
            <button onClick={exportGeoJson}>Export GeoJSON</button>
            <button onClick={() => void exportPdfReport()}>Export PDF Report</button>
            <button onClick={() => void shareSessionSummary()}>Share Session</button>
          </div>
        </section>
      </main>
    </>
  );
}
