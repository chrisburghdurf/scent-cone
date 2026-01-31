import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
  CircleMarker,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

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
    // Also push an initial view update so parent can compute pixel positions
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
      <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: "#2563eb" }} />
      <CircleMarker center={[pos.lat, pos.lon]} radius={18} pathOptions={{ color: "#93c5fd" }} />
    </>
  );
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

      <UserLocationLayer
        enabled={showUserLocation}
        follow={followUser}
        locateToken={locateToken}
        onLocation={onUserLocation}
      />
    </MapContainer>
  );
}


