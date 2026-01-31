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

  // Recompute overlays after pan/zoom ends (prevents mobile “drift” during kinetic move)
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

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
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
        <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
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

  showEnvelope,
  envelopePolygons,
  startPoints,
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
  envelopePolygons?: EnvelopePolygons | null;
  startPoints?: Array<{ label: string; point: LatLon }> | null;
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

      {/* Envelope polygons */}
      {showEnvelope && envelopePolygons?.residual?.length ? (
        <>
          <Polygon
            positions={toLatLngs(envelopePolygons.residual)}
            pathOptions={{ color: "#f59e0b", weight: 2, fillOpacity: 0.10 }}
          />
          <Polygon
            positions={toLatLngs(envelopePolygons.fringe)}
            pathOptions={{ color: "#fb7185", weight: 2, fillOpacity: 0.12 }}
          />
          <Polygon
            positions={toLatLngs(envelopePolygons.core)}
            pathOptions={{ color: "#ef4444", weight: 3, fillOpacity: 0.14 }}
          />
        </>
      ) : null}

      {/* Recommended start points */}
      {showEnvelope && startPoints?.length
        ? startPoints.map((sp, idx) => (
            <CircleMarker
              key={`${sp.label}-${idx}`}
              center={[sp.point.lat, sp.point.lon]}
              radius={6}
              pathOptions={{ color: "#111827" }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                {sp.label}
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




