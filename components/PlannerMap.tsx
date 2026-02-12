import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { ConeDistanceBand, DrawTarget, LatLng, PointSample, PoolingCell } from "@/lib/types";

interface Props {
  lkp: LatLng;
  windSpeedMph: number;
  mapCenter: LatLng;
  canPlaceLkp: boolean;
  userLocation: LatLng | null;
  onSetLkp: (value: LatLng) => void;
  conePolygon: LatLng[];
  coneBands: ConeDistanceBand[];
  poolingCells: PoolingCell[];
  laidTrack: PointSample[];
  dogTrack: PointSample[];
  drawTarget: DrawTarget;
  onAddTrackPoint: (target: Exclude<DrawTarget, "none">, point: LatLng) => void;
  showCone: boolean;
  showPooling: boolean;
  showLaidTrack: boolean;
  showDogTrack: boolean;
  showLkp: boolean;
  playbackLaidMarker: LatLng | null;
  playbackDogMarker: LatLng | null;
  onViewportChange: (zoom: number) => void;
}

function EventBridge({
  drawTarget,
  canPlaceLkp,
  onSetLkp,
  onAddTrackPoint,
  onViewportChange,
}: {
  drawTarget: DrawTarget;
  canPlaceLkp: boolean;
  onSetLkp: (value: LatLng) => void;
  onAddTrackPoint: (target: Exclude<DrawTarget, "none">, point: LatLng) => void;
  onViewportChange: (zoom: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (drawTarget === "none" && canPlaceLkp) onSetLkp(point);
      if (drawTarget === "laid") onAddTrackPoint("laid", point);
      if (drawTarget === "dog") onAddTrackPoint("dog", point);
    },
    zoomend: (e) => {
      onViewportChange(e.target.getZoom());
    },
  });
  return null;
}

function RecenterMap({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center.lat, center.lng, map]);
  return null;
}

export default function PlannerMap(props: Props) {
  const conePositions = useMemo(
    () => props.conePolygon.map((p) => [p.lat, p.lng] as [number, number]),
    [props.conePolygon],
  );
  const laidTrackSegments = useMemo(() => {
    const segments: Array<{ positions: [number, number][]; color: string }> = [];
    for (let i = 1; i < props.laidTrack.length; i += 1) {
      const a = props.laidTrack[i - 1];
      const b = props.laidTrack[i];
      const speed = (a.speedKmh ?? b.speedKmh ?? 0);
      let color = "#2563eb";
      if (speed < 0.8) color = "#6b7280"; // stationary / near stationary
      else if (speed < 3) color = "#22c55e"; // walking
      else if (speed < 6) color = "#eab308"; // brisk movement
      else color = "#f97316"; // fast movement
      segments.push({
        positions: [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        color,
      });
    }
    return segments;
  }, [props.laidTrack]);

  return (
    <MapContainer
      center={[props.mapCenter.lat, props.mapCenter.lng]}
      zoom={12}
      style={{ width: "100%", height: "100%", borderRadius: 12 }}
      scrollWheelZoom
    >
      <RecenterMap center={props.mapCenter} />
      <EventBridge
        drawTarget={props.drawTarget}
        canPlaceLkp={props.canPlaceLkp}
        onSetLkp={props.onSetLkp}
        onAddTrackPoint={props.onAddTrackPoint}
        onViewportChange={props.onViewportChange}
      />

      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {props.showCone && conePositions.length > 2 ? (
        <>
          <Polygon
            positions={conePositions}
            pathOptions={{ color: "#fb923c", fillColor: "#fdba74", fillOpacity: 0.28, weight: 2 }}
          />
          {props.coneBands.map((band) => (
            <Polyline
              key={`band-line-${band.minutes}`}
              positions={[
                [band.left.lat, band.left.lng],
                [band.right.lat, band.right.lng],
              ]}
              pathOptions={{ color: "#7c2d12", weight: 2, dashArray: "6 8", opacity: 0.72 }}
            />
          ))}
          {props.coneBands.map((band) => (
            <CircleMarker
              key={`band-center-${band.minutes}`}
              center={[band.center.lat, band.center.lng]}
              radius={5}
              pathOptions={{ color: "#7c2d12", fillColor: "#7c2d12", fillOpacity: 0.95 }}
            >
              <Tooltip permanent direction="right" offset={[8, 0]}>
                {band.minutes}m
              </Tooltip>
            </CircleMarker>
          ))}
        </>
      ) : null}

      {props.showPooling
        ? props.poolingCells.map((cell, idx) => {
            const intensity = 0.15 + cell.score * 0.55;
            return (
              <Polygon
                key={`pool-${idx}`}
                positions={cell.polygon.map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: "#0f766e",
                  weight: 1,
                  fillColor: "#14b8a6",
                  fillOpacity: intensity,
                }}
              />
            );
          })
        : null}

      {props.showLaidTrack
        ? laidTrackSegments.map((segment, idx) => (
            <Polyline
              key={`laid-segment-${idx}`}
              positions={segment.positions}
              pathOptions={{ color: segment.color, weight: 5, lineCap: "round" }}
            />
          ))
        : null}

      {props.showDogTrack && props.dogTrack.length > 0 ? (
        <Polyline
          positions={props.dogTrack.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: "#dc2626", weight: 4 }}
        />
      ) : null}

      {props.showLkp ? (
        <CircleMarker center={[props.lkp.lat, props.lkp.lng]} radius={8} pathOptions={{ color: "#111827" }}>
          <Tooltip permanent direction="top" offset={[0, -6]}>
            {props.windSpeedMph.toFixed(1)} mph
          </Tooltip>
        </CircleMarker>
      ) : null}

      {props.playbackLaidMarker ? (
        <CircleMarker
          center={[props.playbackLaidMarker.lat, props.playbackLaidMarker.lng]}
          radius={6}
          pathOptions={{ color: "#1d4ed8", fillColor: "#1d4ed8" }}
        />
      ) : null}

      {props.playbackDogMarker ? (
        <CircleMarker
          center={[props.playbackDogMarker.lat, props.playbackDogMarker.lng]}
          radius={6}
          pathOptions={{ color: "#b91c1c", fillColor: "#b91c1c" }}
        />
      ) : null}

      {props.userLocation ? (
        <CircleMarker
          center={[props.userLocation.lat, props.userLocation.lng]}
          radius={7}
          pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.95, weight: 2 }}
        />
      ) : null}
    </MapContainer>
  );
}
