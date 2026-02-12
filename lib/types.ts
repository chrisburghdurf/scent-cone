export type Mode = "live" | "historical" | "forecast";
export type DrawTarget = "none" | "laid" | "dog";
export type PoolingSensitivity = "low" | "medium" | "high";
export type Stability = "low" | "medium" | "high";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PointSample extends LatLng {
  ts?: string;
  speedKmh?: number;
}

export interface SavedTrack {
  id: string;
  name: string;
  createdAt: string;
  points: PointSample[];
  notes?: string;
}

export interface WeatherSnapshot {
  windSpeed: number;
  windSpeedUnit: string;
  windFromDeg: number;
  temperatureC: number;
  dewPointC: number;
  requestedTime: string;
  resolvedTime: string;
  source: string;
  kind: "live" | "historical" | "forecast";
  lastUpdated: string;
}

export interface ConeSettings {
  timeHorizonHours: number;
  spreadDeg: number;
  stability: Stability;
}

export interface Profile {
  id: string;
  name: string;
  notes?: string;
  retired?: boolean;
}

export interface K9Profile extends Profile {
  breed?: string;
}

export interface HandlerProfile extends Profile {
  agency?: string;
}

export interface SessionRecord {
  id: string;
  name: string;
  mode: Mode;
  createdAt: string;
  lkp: LatLng;
  requestedTime: string;
  weather: WeatherSnapshot | null;
  coneSettings: ConeSettings;
  useManualOverride: boolean;
  manualWindSpeed?: number;
  manualWindFromDeg?: number;
  manualTempC?: number;
  manualDewPointC?: number;
  scentPoolingEnabled: boolean;
  scentPoolingSensitivity: PoolingSensitivity;
  terrainDataSource: string;
  laidTrack: PointSample[];
  dogTrack: PointSample[];
  laidTrackTime?: string;
  runTime?: string;
  k9Id?: string;
  k9Name?: string;
  handlerId?: string;
  handlerName?: string;
  notes?: string;
}

export interface PoolingCell {
  polygon: LatLng[];
  score: number;
}

export interface PoolingResult {
  cells: PoolingCell[];
  source: string;
  generatedAt: string;
  disclaimer: string;
}

export interface ConeDistanceBand {
  minutes: number;
  distanceM: number;
  center: LatLng;
  left: LatLng;
  right: LatLng;
}

export interface TrackMetrics {
  minSeparationM: number;
  avgSeparationM: number;
  maxSeparationM: number;
  dogInsideConePct: number;
  laidTrackTransitions: number;
}
