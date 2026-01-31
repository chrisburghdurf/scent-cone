import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
  CircleMarker,
  Polygon,
  Tooltip,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

type LatLon = { lat: number; lon: number };

type EnvelopePolygons = {
  core: LatLon[];
  fringe: LatLon[];
  residual: LatLon[];
};

type EnvelopeBand = {
  minutes: number;
  polygons: EnvelopePolygons;
  confidence_score: number;
  confidence_band: "High" | "Moderate" | "Low";
};

type Trap = { id: string; lat: number; lon: number; label: string };

type LKP = { id: string; lat: number; lon: number; timeISO: string; label?: string };

function MapReporter({
  onReady,
  onViewChanged,
}: {
  onReady: (map: LeafletMap) => void;
  onViewChanged: (map: LeafletMap) => void;
}) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
    onViewChanged(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMapEvents({
    zoomend() {
      onViewChanged(map);
    },
    moveend() {
      onViewChanged(map);
    },
    resize() {
      onViewChanged(map);
    },
  });

  return null;
}

function ClickHandler({
  onClick,
}: {
  onClick: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function UserLocationLayer({
  enabled,
  follow,
  locateToken,
  onLocation,
}: {
  enabled: boolean;
  follow: boolean;
  locateToken: number;
  onLocation?: (lat: number, lon: number) => void;
}) {
  const map = useMap();
  const watchIdRef = useRef<number | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setPos(null);
      return;
    }
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        setPos({ lat, lon });
        onLocation?.(lat, lon);

        if (follow) {
          map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, follow, map, onLocation]);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        setPos({ lat, lon });
        onLocation?.(lat, lon);
        map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }, [locateToken, enabled, map, onLocation]);

  if (!enabled || !pos) return null;

  return (
    <>
      <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: "#2563eb" }}>
        <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
          My location
        </Tooltip>
      </CircleMarker>
      <CircleMarker center={[pos.lat, pos.lon]} radius={18} pathOptions={{ color: "#93c5fd" }} />
    </>
  );
}

function toLatLngs(poly: LatLon[]) {
  return poly.map((p) => [p.lat, p.lon] as [number, number]);
}

export default function LeafletMapInner({
  center,
  zoom,

  onMapClick,
  onMapReady,
  onViewChanged,

  showUserLocation,
  followUser,
  locateToken,
  onUserLocation,

  // display layers
  showEnvelope,
  envelopeNow,
  envelopeBands,

  // points/layers
  startPoints,
  traps,
  lkps,
  activeLkpId,
}: {
  center: LatLngExpression;
  zoom: number;

  onMapClick: (lat: number, lon: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onViewChanged: (map: LeafletMap) => void;

  showUserLocation: boolean;
  followUser: boolean;
  locateToken: number;
  onUserLocation?: (lat: number, lon: number) => void;

  showEnvelope: boolean;
  envelopeNow?: EnvelopePolygons | null;
  envelopeBands?: EnvelopeBand[] | null;

  startPoints?: Array<{ label: string; point: LatLon }> | null;
  traps?: Trap[] | null;

  lkps?: LKP[] | null;
  activeLkpId?: string | null;
}) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ width: "100%", height: "100%" }}>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        crossOrigin="anonymous"
      />

      <MapReporter onReady={onMapReady} onViewChanged={onViewChanged} />
      <ClickHandler onClick={onMapClick} />

      {/* TIME BANDS: draw oldest first, newest last */}
      {showEnvelope && envelopeBands?.length
        ? envelopeBands
            .slice()
            .sort((a, b) => a.minutes - b.minutes)
            .map((band, idx, arr) => {
              const n = arr.length;
              const t = n <= 1 ? 1 : idx / (n - 1); // 0..1
              const fillBase = 0.16;
              const fade = 1 - t; // older gets lower opacity
              const opCore = fillBase * (0.35 + 0.65 * fade);
              const opFringe = opCore * 0.85;
              const opResid = opCore * 0.70;

              return (
                <React.Fragment key={`band-${band.minutes}`}>
                  <Polygon
                    positions={toLatLngs(band.polygons.residual)}
                    pathOptions={{ color: "#f59e0b", weight: 1, fillOpacity: opResid }}
                  />
                  <Polygon
                    positions={toLatLngs(band.polygons.fringe)}
                    pathOptions={{ color: "#fb7185", weight: 1, fillOpacity: opFringe }}
                  />
                  <Polygon
                    positions={toLatLngs(band.polygons.core)}
                    pathOptions={{ color: "#ef4444", weight: 2, fillOpacity: opCore }}
                  />
                </React.Fragment>
              );
            })
        : null}

      {/* Single “now” envelope fallback */}
      {showEnvelope && !envelopeBands?.length && envelopeNow?.residual?.length ? (
        <>
          <Polygon positions={toLatLngs(envelopeNow.residual)} pathOptions={{ color: "#f59e0b", weight: 2, fillOpacity: 0.10 }} />
          <Polygon positions={toLatLngs(envelopeNow.fringe)} pathOptions={{ color: "#fb7185", weight: 2, fillOpacity: 0.12 }} />
          <Polygon positions={toLatLngs(envelopeNow.core)} pathOptions={{ color: "#ef4444", weight: 3, fillOpacity: 0.14 }} />
        </>
      ) : null}

      {/* Recommended start points */}
      {showEnvelope && startPoints?.length
        ? startPoints.map((sp, idx) => (
            <CircleMarker key={`${sp.label}-${idx}`} center={[sp.point.lat, sp.point.lon]} radius={6} pathOptions={{ color: "#111827" }}>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                {sp.label}
              </Tooltip>
            </CircleMarker>
          ))
        : null}

      {/* Terrain traps */}
      {traps?.length
        ? traps.map((t) => (
            <CircleMarker key={t.id} center={[t.lat, t.lon]} radius={7} pathOptions={{ color: "#0f766e" }}>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                {t.label}
              </Tooltip>
            </CircleMarker>
          ))
        : null}

      {/* Multi-LKP markers */}
      {lkps?.length
        ? lkps.map((k) => (
            <CircleMarker
              key={k.id}
              center={[k.lat, k.lon]}
              radius={k.id === activeLkpId ? 8 : 6}
              pathOptions={{ color: k.id === activeLkpId ? "#111827" : "#6b7280" }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                {k.label ? `${k.label}` : "LKP"}{" "}
                {k.id === activeLkpId ? "(active)" : ""}
              </Tooltip>
            </CircleMarker>
          ))
        : null}

      <UserLocationLayer
        enabled={showUserLocation}
        follow={followUser}
        locateToken={locateToken}
        onLocation={onUserLocation}
      />
    </MapContainer>
  );
}
