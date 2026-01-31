"use client";

import React from "react";
import LeafletMapInner from "./LeafletMapInner";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";

type LatLon = { lat: number; lon: number };

type EnvelopePolygons = {
  core: LatLon[];
  fringe: LatLon[];
  residual: LatLon[];
};

export default function LeafletMapClient(props: {
  center: LatLngExpression;
  zoom: number;

  onMapClick: (lat: number, lon: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onViewChanged: (map: LeafletMap) => void;

  showUserLocation: boolean;
  followUser: boolean;
  locateToken: number;
  onUserLocation?: (lat: number, lon: number) => void;

  // NEW: envelope support
  showEnvelope: boolean;
  envelopePolygons?: EnvelopePolygons | null;
  startPoints?: Array<{ label: string; point: LatLon }> | null;
}) {
  return <LeafletMapInner {...props} />;
}
