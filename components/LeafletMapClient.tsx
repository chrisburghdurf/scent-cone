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

type EnvelopeBand = {
  minutes: number;
  polygons: EnvelopePolygons;
  confidence_score: number;
  confidence_band: "High" | "Moderate" | "Low";
};

type Trap = { id: string; lat: number; lon: number; label: string };

type LKP = { id: string; lat: number; lon: number; timeISO: string; label?: string };

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

  showEnvelope: boolean;
  envelopeNow?: EnvelopePolygons | null;
  envelopeBands?: EnvelopeBand[] | null;

  startPoints?: Array<{ label: string; point: LatLon }> | null;
  traps?: Trap[] | null;

  lkps?: LKP[] | null;
  activeLkpId?: string | null;
}) {
  return <LeafletMapInner {...props} />;
}
