import React, { useMemo, useRef, useState } from "react";
import ConeCanvas from "@/components/ConeCanvas";
import { WindData } from "@/lib/cone";

type CalPoint = {
  px: { x: number; y: number } | null;
  lat: number | null;
  lon: number | null;
};

function solveLinearMap(a: CalPoint, b: CalPoint) {
  if (!a.px || !b.px || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;

  const dx = b.px.x - a.px.x;
  const dy = b.px.y - a.px.y;

  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;

  const kLon = dx !== 0 ? dLon / dx : null;
  const kLat = dy !== 0 ? dLat / dy : null;

  if (kLon == null || kLat == null) return null;
  return { a, kLon, kLat };
}

export default function ScreenshotMode() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [srcPoint, setSrcPoint] = useState<{ x: number; y: number } | null>(null);
  const [wind, setWind] = useState<WindData | null>(null);

  const [lengthPx, setLengthPx] = useState(900);
  const [halfAngleDeg, setHalfAngleDeg] = useState<"auto" | number>("auto");

  const [calA, setCalA] = useState<CalPoint>({ px: null, lat: null, lon: null });
  const [calB, setCalB] = useState<CalPoint>({ px: null, lat: null, lon: null });
  const [mode, setMode] = useState<"none" | "A" | "B" | "SRC">("none");

  const [windMode, setWindMode] = useState<"current" | "hourly" | "manual">("current");
  const [manualSpeedMph, setManualSpeedMph] = useState<number>(11);
  const [manualFromDeg, setManualFromDeg] = useState<number>(315);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  const W = imgEl?.naturalWidth ?? 1200;
  const H = imgEl?.naturalHeight ?? 800;

  const mapping = useMemo(() => solveLinearMap(calA, calB), [calA, calB]);

  function pixelToLatLon(px: { x: number; y: number }) {
    if (!mapping) return null;
    const { a, kLat, kLon } = mapping;
    if (!a.px || a.lat == null || a.lon == null) return null;

    const lon = a.lon + (px.x - a.px.x) * kLon;
    const lat = a.lat + (px.y - a.px.y) * kLat;
    return { lat, lon };
  }

  async function fetchWind(lat: number, lon: number) {
    setWind(null);
    const r = await fetch("/api/wind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, mode: windMode === "hourly" ? "hourly" : "current" }),
    });
    const js = await r.json();
    if (!r.ok) throw new Error(js?.error || "Wind fetch failed");
    setWind(js);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          width: "100%",
          height: 520,
          borderRadius: 12,
          overflow: "auto",
          border: "1px solid #e5e7eb",
        }}
      >
        {!imgEl ? (
          <div style={{ padding: 18, color: "#6b7280" }}>Upload a screenshot to begin.</div>
        ) : (
          <div style={{ width: W, height: H }}>
            <ConeCanvas
              width={W}
              height={H}
              srcPoint={srcPoint}
              wind={wind}
              lengthPx={lengthPx}
              halfAngleDeg={halfAngleDeg}
              backgroundImage={imgEl}
              onClick={async (pt) => {
                if (mode === "A") {
                  setCalA((p) => ({ ...p, px: pt }));
                  setMode("none");
                  return;
                }
                if (mode === "B") {
                  setCalB((p) => ({ ...p, px: pt }));
                  setMode("none");
                  return;
                }
                if (mode === "SRC") {
                  setSrcPoint(pt);
                  const ll = pixelToLatLon(pt);
                  if (!ll) {
                    alert("Calibration incomplete. Set Cal A + Cal B (both pixel and lat/lon).");
                    return;
                  }

                  if (windMode === "manual") {
                    setWind({
                      wind_speed_mps: manualSpeedMph / 2.236936,
                      wind_dir_from_deg: manualFromDeg,
                      time_local: "manual",
                      time_utc: "manual",
                      timezone: "manual",
                      utc_offset_seconds: 0,
                    } as any);
                    setMode("none");
                    return;
                  }

                  try {
                    await fetchWind(ll.lat, ll.lon);
                  } catch (e: any) {
                    alert(e?.message || String(e));
                  }
                  setMode("none");
                  return;
                }
              }}
            />
          </div>
        )}
      </div>

      <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Screenshot Mode</h3>

        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = URL.createObjectURL(f);
            const im = new Image();
            im.onload = () => {
              setImgEl(im);
              setSrcPoint(null);
              setWind(null);
              setCalA({ px: null, lat: null, lon: null });
              setCalB({ px: null, lat: null, lon: null });
              setMode("none");
            };
            im.src = url;
          }}
        />

        <label style={{ display: "block", marginTop: 12 }}>Wind source</label>
        <select
          value={windMode}
          onChange={(e) => setWindMode(e.target.value as any)}
          style={{ width: "100%", padding: 10, borderRadius: 10 }}
          disabled={!imgEl}
        >
          <option value="current">Auto (Current)</option>
          <option value="hourly">Auto (Hourly)</option>
          <option value="manual">Manual</option>
        </select>

        {windMode === "manual" && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <input
              type="number"
              value={manualSpeedMph}
              onChange={(e) => setManualSpeedMph(Number(e.target.value))}
              placeholder="Wind speed (mph)"
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
              disabled={!imgEl}
            />
            <input
              type="number"
              value={manualFromDeg}
              onChange={(e) => setManualFromDeg(Number(e.target.value))}
              placeholder="Wind FROM degrees (0=N,90=E)"
              style={{ width: "100%", padding: 10, borderRadius: 10 }}
              disabled={!imgEl}
            />
          </div>
        )}

        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f9fafb" }}>
          <b>Calibration (2 points)</b>
          <p style={{ margin: "6px 0", color: "#6b7280", fontSize: 12 }}>
            Click Cal A on the image, enter its lat/lon. Then do Cal B. Works best with north-up screenshots.
          </p>

          <button
            onClick={() => setMode("A")}
            style={{ width: "100%", padding: 10, borderRadius: 10 }}
            disabled={!imgEl}
          >
            Set Cal A (click image)
          </button>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              placeholder="Cal A lat"
              value={calA.lat ?? ""}
              onChange={(e) => setCalA((p) => ({ ...p, lat: e.target.value === "" ? null : Number(e.target.value) }))}
              style={{ flex: 1, padding: 10, borderRadius: 10 }}
            />
            <input
              placeholder="Cal A lon"
              value={calA.lon ?? ""}
              onChange={(e) => setCalA((p) => ({ ...p, lon: e.target.value === "" ? null : Number(e.target.value) }))}
              style={{ flex: 1, padding: 10, borderRadius: 10 }}
            />
          </div>

          <button
            onClick={() => setMode("B")}
            style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 10 }}
            disabled={!imgEl}
          >
            Set Cal B (click image)
          </button>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              placeholder="Cal B lat"
              value={calB.lat ?? ""}
              onChange={(e) => setCalB((p) => ({ ...p, lat: e.target.value === "" ? null : Number(e.target.value) }))}
              style={{ flex: 1, padding: 10, borderRadius: 10 }}
            />
            <input
              placeholder="Cal B lon"
              value={calB.lon ?? ""}
              onChange={(e) => setCalB((p) => ({ ...p, lon: e.target.value === "" ? null : Number(e.target.value) }))}
              style={{ flex: 1, padding: 10, borderRadius: 10 }}
            />
          </div>

          <button
            onClick={() => setMode("SRC")}
            style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 12 }}
            disabled={!imgEl}
          >
            Set Source (click image)
          </button>
        </div>

        <label style={{ display: "block", marginTop: 12 }}>Cone length</label>
        <input
          type="range"
          min={200}
          max={1600}
          value={lengthPx}
          onChange={(e) => setLengthPx(Number(e.target.value))}
          style={{ width: "100%" }}
          disabled={!imgEl}
        />

        <label style={{ display: "block", marginTop: 12 }}>Half-angle</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setHalfAngleDeg("auto")} style={{ flex: 1, padding: 10, borderRadius: 10 }}>
            Auto
          </button>
          <input
            type="number"
            min={5}
            max={60}
            value={halfAngleDeg === "auto" ? 18 : halfAngleDeg}
            onChange={(e) => setHalfAngleDeg(Number(e.target.value))}
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
            disabled={halfAngleDeg === "auto" || !imgEl}
          />
        </div>
      </div>
    </div>
  );
}
