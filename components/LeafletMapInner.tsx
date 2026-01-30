import React from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
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
      const pt = map.latLngToContainerPoint(e.latlng); // pixel point in the map container
      onClick(e.latlng.lat, e.latlng.lng, pt.x, pt.y);
    },
  });

  return null;
}

export default function LeafletMapInner({
  center,
  zoom,
  onMapClick,
}: {
  center: LatLngExpression;
  zoom: number;
  onMapClick: (lat: number, lon: number, px: number, py: number) => void;
}) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ width: "100%", height: "100%" }}>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onMapClick} />
    </MapContainer>
  );
}

