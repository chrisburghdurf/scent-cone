import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
  CircleMarker,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

function ClickHandler({
  onClick,
}: {
  onClick: (lat: number, lon: number, px: number, py: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      const pt = map.latLngToContainerPoint(e.latlng);
      onClick(e.latlng.lat, e.latlng.lng, pt.x, pt.y);
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

  // Start/stop GPS watch
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
      () => {
        // user denied or GPS unavailable; keep silent
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, follow, map, onLocation]);

  // “Locate me now” button trigger
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
      {/* Blue dot for current location */}
      <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: "#2563eb" }} />
      <CircleMarker center={[pos.lat, pos.lon]} radius={18} pathOptions={{ color: "#93c5fd" }} />
    </>
  );
}

export default function LeafletMapInner({
  center,
  zoom,
  onMapClick,
  showUserLocation,
  followUser,
  locateToken,
  onUserLocation,
}: {
  center: LatLngExpression;
  zoom: number;
  onMapClick: (lat: number, lon: number, px: number, py: number) => void;

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


