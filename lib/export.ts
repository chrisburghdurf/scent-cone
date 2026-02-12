import { LatLng, SessionRecord } from "@/lib/types";

function featureProperties(session: SessionRecord) {
  return {
    session_id: session.id,
    k9_id: session.k9Id ?? null,
    k9_name: session.k9Name ?? null,
    handler_id: session.handlerId ?? null,
    handler_name: session.handlerName ?? null,
    scent_pooling_enabled: session.scentPoolingEnabled,
    scent_pooling_sensitivity: session.scentPoolingSensitivity,
    terrain_data_source: session.terrainDataSource,
  };
}

function asLine(points: LatLng[]) {
  return points.map((p) => [p.lng, p.lat]);
}

export function buildSessionGeoJson(session: SessionRecord, conePolygon: LatLng[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { ...featureProperties(session), feature_type: "scent_cone" },
        geometry: {
          type: "Polygon",
          coordinates: [asLine(conePolygon)],
        },
      },
      {
        type: "Feature",
        properties: { ...featureProperties(session), feature_type: "laid_track" },
        geometry: {
          type: "LineString",
          coordinates: asLine(session.laidTrack),
        },
      },
      {
        type: "Feature",
        properties: { ...featureProperties(session), feature_type: "dog_path" },
        geometry: {
          type: "LineString",
          coordinates: asLine(session.dogTrack),
        },
      },
    ],
  };
}

export function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
