// lib/scentEnvelope.ts
// Probability-weighted, time-aware scent envelope (decision support)
// No external dependencies.

export type TerrainType = "mixed" | "open" | "forest" | "urban" | "swamp" | "beach";

export type StabilityType = "stable" | "neutral" | "convective"; // proxy for solar/thermals

export type PrecipType = "none" | "light" | "moderate" | "heavy";

export type EnvelopeInputs = {
  // Required
  lkp_lat: number;
  lkp_lon: number;
  lkp_time_iso: string;     // ISO string
  now_time_iso: string;     // ISO string
  wind_from_deg: number;    // meteorological FROM direction degrees (0=N,90=E)
  wind_speed_mph: number;

  // Optional environment (defaults applied)
  temperature_f?: number;     // default 75
  rel_humidity_pct?: number;  // default 50
  cloud: "clear" | "partly" | "overcast" | "night"; // default "partly"
  precip: PrecipType;         // default "none"
  recent_rain: boolean;       // default false
  terrain: TerrainType;       // default "mixed"
  stability: StabilityType;   // default "neutral"
};

export type LatLon = { lat: number; lon: number };

export type EnvelopeOutput = {
  t_minutes: number;

  polygons: {
    core: LatLon[];
    fringe: LatLon[];
    residual: LatLon[];
  };

  confidence_score: number;          // 0–100
  confidence_band: "High" | "Moderate" | "Low";

  recommended_start_points: Array<{ label: string; point: LatLon }>;

  deployment_notes: string[];
  reset_recommendation_minutes: number;
};

/** --- helpers --- **/

const R_EARTH_M = 6371000;

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function deg2rad(d: number) {
  return (d * Math.PI) / 180;
}
function rad2deg(r: number) {
  return (r * 180) / Math.PI;
}

/**
 * Destination point given start lat/lon, bearing degrees (0=N), distance meters.
 * Great-circle formula.
 */
function destinationPoint(start: LatLon, bearingDeg: number, distM: number): LatLon {
  const φ1 = deg2rad(start.lat);
  const λ1 = deg2rad(start.lon);
  const θ = deg2rad(bearingDeg);
  const δ = distM / R_EARTH_M;

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  // normalize lon to [-180, 180]
  const lon = ((rad2deg(λ2) + 540) % 360) - 180;
  return { lat: rad2deg(φ2), lon };
}

function feetToMeters(ft: number) {
  return ft * 0.3048;
}

function minutesSince(lkp_iso: string, now_iso: string) {
  const t0 = Date.parse(lkp_iso);
  const t1 = Date.parse(now_iso);
  const mins = (t1 - t0) / (1000 * 60);
  return Math.max(0, mins);
}

function downwindBearingDeg(wind_from_deg: number) {
  return (wind_from_deg + 180) % 360;
}

/**
 * Build a cone/fan polygon:
 * - start at apex (LKP)
 * - sweep arc at far radius (L) from centerline ± halfAngle
 * - close back to apex
 */
function conePolygon(
  apex: LatLon,
  centerlineBearingDeg: number,
  L_m: number,
  halfAngleDeg: number,
  arcPoints = 32
): LatLon[] {
  const pts: LatLon[] = [];
  pts.push(apex);

  const start = centerlineBearingDeg - halfAngleDeg;
  const end = centerlineBearingDeg + halfAngleDeg;

  for (let i = 0; i <= arcPoints; i++) {
    const b = start + (i / arcPoints) * (end - start);
    pts.push(destinationPoint(apex, b, L_m));
  }

  pts.push(apex);
  return pts;
}

/** --- model pieces from your spec (tunable) --- **/

function terrainLenMult(terrain: TerrainType): number {
  switch (terrain) {
    case "open": return 1.10;
    case "forest": return 0.95;
    case "urban": return 0.85;
    case "swamp": return 0.90;
    case "beach": return 1.00;
    default: return 1.00; // mixed
  }
}

function stabilityMult(stability: StabilityType): number {
  // affects length slightly; mixing handled more in width
  switch (stability) {
    case "stable": return 0.90;
    case "convective": return 1.05;
    default: return 1.00;
  }
}

function mixMult(stability: StabilityType, terrain: TerrainType): number {
  let m = 1.0;
  if (stability === "stable") m *= 0.85;
  if (stability === "convective") m *= 1.25;
  if (terrain === "urban") m *= 1.15;
  return m;
}

function confidenceTauMinutes(tempF: number, rh: number, cloud: EnvelopeInputs["cloud"], windMph: number): number {
  // default neutral = 180
  // mild/cool/humid/cloudy -> 240
  // hot/dry/sunny/windy -> 120
  let tau = 180;

  const humid = rh > 60;
  const dry = rh < 30;
  const hot = tempF > 85;
  const cool = tempF < 60;
  const sunny = cloud === "clear";
  const stableish = cloud === "overcast" || cloud === "night";
  const windy = windMph >= 13;

  if ((humid || cool) && stableish && !windy) tau = 240;
  if ((hot || dry || sunny) && windy) tau = 120;

  return tau;
}

function confidenceMultipliers(tempF: number, rh: number, cloud: EnvelopeInputs["cloud"], precip: PrecipType, recentRain: boolean, windMph: number) {
  // Humidity
  let HumMult = 1.0;
  if (rh < 30) HumMult = 0.80;
  else if (rh > 60) HumMult = 1.10;

  // Temperature
  let TempMult = 1.0;
  if (tempF > 85) TempMult = 0.85;
  else if (tempF < 60) TempMult = 1.05;

  // Sun/UV (cloud proxy)
  let SunMult = 1.0;
  if (cloud === "clear") SunMult = 0.85;
  else if (cloud === "partly") SunMult = 0.95;
  else if (cloud === "overcast" || cloud === "night") SunMult = 1.05;

  // Precip
  let RainMult = 1.0;
  if (precip === "heavy") RainMult = 0.75;
  else if (precip === "moderate" || precip === "light") RainMult = 0.90;
  if (precip === "none" && recentRain) RainMult *= 0.95;

  // Wind speed
  let WindMult = 1.0;
  if (windMph <= 3) WindMult = 0.85;
  else if (windMph >= 13 && windMph <= 18) WindMult = 0.90;
  else if (windMph > 18) WindMult = 0.80;

  return { HumMult, TempMult, SunMult, RainMult, WindMult };
}

/** Main function */
export function computeScentEnvelope(inputRaw: EnvelopeInputs): EnvelopeOutput {
  // defaults
  const input: EnvelopeInputs = {
    ...inputRaw,
    temperature_f: inputRaw.temperature_f ?? 75,
    rel_humidity_pct: inputRaw.rel_humidity_pct ?? 50,
    cloud: inputRaw.cloud ?? "partly",
    precip: inputRaw.precip ?? "none",
    recent_rain: inputRaw.recent_rain ?? false,
    terrain: inputRaw.terrain ?? "mixed",
    stability: inputRaw.stability ?? "neutral",
  };

  const t = minutesSince(input.lkp_time_iso, input.now_time_iso);
  const W = Math.max(0, input.wind_speed_mph);
  const W_eff = Math.min(W, 18);

  // --- length (feet) ---
  const L_base_ft = 30 + 6.0 * t;
  const L_wind_ft = 120 * W_eff * Math.log(1 + t / 30);
  const L_ft = (L_base_ft + L_wind_ft) * terrainLenMult(input.terrain) * stabilityMult(input.stability);

  // --- width at far end (feet) ---
  const Width_end_ft = (20 + 3.5 * t + 40 * Math.sqrt(t)) * mixMult(input.stability, input.terrain);

  // Convert width-> half angle: halfAngle = atan(Width_end / L)
  // Width_end_ft in spec is half-width at far end already (your spec calls it Width_end).
  // so halfAngle = atan(Width_end / L)
  const halfAngleRad = Math.atan2(Width_end_ft, Math.max(1, L_ft));
  const halfAngleDeg = rad2deg(halfAngleRad);

  const apex: LatLon = { lat: input.lkp_lat, lon: input.lkp_lon };
  const axis = downwindBearingDeg(input.wind_from_deg);

  // Zones scaling
  const L_core_m = feetToMeters(0.55 * L_ft);
  const L_fringe_m = feetToMeters(0.85 * L_ft);
  const L_resid_m = feetToMeters(1.0 * L_ft);

  const coreAngleDeg = halfAngleDeg * 0.45;
  const fringeAngleDeg = halfAngleDeg * 0.80;
  const residAngleDeg = halfAngleDeg * 1.15;

  const polygons = {
    core: conePolygon(apex, axis, L_core_m, coreAngleDeg, 28),
    fringe: conePolygon(apex, axis, L_fringe_m, fringeAngleDeg, 32),
    residual: conePolygon(apex, axis, L_resid_m, residAngleDeg, 36),
  };

  // Confidence
  const tau = confidenceTauMinutes(input.temperature_f!, input.rel_humidity_pct!, input.cloud, W);
  const C_time = 100 * Math.exp(-t / tau);

  const { HumMult, TempMult, SunMult, RainMult, WindMult } = confidenceMultipliers(
    input.temperature_f!, input.rel_humidity_pct!, input.cloud, input.precip, input.recent_rain, W
  );

  const C_env = HumMult * TempMult * SunMult * RainMult * WindMult;
  const C = clamp(C_time * C_env, 5, 100);

  const band: EnvelopeOutput["confidence_band"] =
    C >= 70 ? "High" : C >= 40 ? "Moderate" : "Low";

  // Start points (in line with your spec)
  const startPoints: Array<{ label: string; point: LatLon }> = [];
  startPoints.push({ label: "LKP (Immediate)", point: apex });

  const mid_m = feetToMeters(0.35 * L_ft);
  const far_m = feetToMeters(0.55 * L_ft);
  startPoints.push({ label: "Core midline (~35%)", point: destinationPoint(apex, axis, mid_m) });
  startPoints.push({ label: "Core far edge (~55%)", point: destinationPoint(apex, axis, far_m) });

  // Notes (simple, defensible rules)
  const notes: string[] = [];
  if (W <= 3 || input.terrain === "urban" || input.terrain === "forest") {
    notes.push("Pooling/eddies likely—work LKP, leeward sides, and terrain traps; expect broken scent.");
  }
  if (W >= 4 && W <= 12 && C >= 50) {
    notes.push("Cone strategy appropriate—deploy downwind along core axis, bracket fringe edges.");
  }
  if (W >= 13 || input.precip === "heavy") {
    notes.push("Higher dilution/variability—use shorter commitments, more frequent resets, multiple start points.");
  }

  // Reset recommendation
  const reset = C < 40 ? 30 : C < 70 ? 45 : 60;

  return {
    t_minutes: t,
    polygons,
    confidence_score: Math.round(C),
    confidence_band: band,
    recommended_start_points: startPoints,
    deployment_notes: notes,
    reset_recommendation_minutes: reset,
  };
}
