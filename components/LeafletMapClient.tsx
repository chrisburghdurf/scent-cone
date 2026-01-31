"use client";

import React from "react";
import LeafletMapInner from "./LeafletMapInner";
import type { LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";

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
}) {
  return <LeafletMapInner {...props} />;
}
