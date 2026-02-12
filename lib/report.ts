import { SessionRecord, TrackMetrics, WeatherSnapshot } from "@/lib/types";

function weatherLine(weather: WeatherSnapshot | null): string {
  if (!weather) return "Weather unavailable; manual override values used.";
  return `${weather.kind.toUpperCase()} | Wind ${weather.windSpeed.toFixed(1)} ${weather.windSpeedUnit} FROM ${Math.round(weather.windFromDeg)}deg | Temp ${weather.temperatureC.toFixed(1)}C | Dew ${weather.dewPointC.toFixed(1)}C | Requested ${new Date(weather.requestedTime).toLocaleString()} | Resolved ${new Date(weather.resolvedTime).toLocaleString()} | Source ${weather.source}`;
}

export function openPdfReportWindow(args: {
  session: SessionRecord;
  metrics: TrackMetrics;
  mapImageDataUrl: string;
}) {
  const { session, metrics, mapImageDataUrl } = args;
  const w = window.open("", "_blank", "noopener,noreferrer,width=1100,height=850");
  if (!w) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Training Report - ${session.name}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111827; }
    h1 { margin: 0 0 6px; }
    h2 { margin-top: 18px; }
    .muted { color: #4b5563; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
    .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin-top: 10px; }
    img { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; }
    .disclaimer { margin-top: 8px; font-size: 12px; color: #374151; }
    @media print { button { display: none; } body { margin: 0; padding: 14mm; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Print / Save as PDF</button>
  <h1>SAR Training Report</h1>
  <div class="muted">Generated ${new Date().toLocaleString()}</div>

  <div class="card grid">
    <div><strong>Session</strong>: ${session.name}</div>
    <div><strong>Session ID</strong>: ${session.id}</div>
    <div><strong>Mode</strong>: ${session.mode.toUpperCase()}</div>
    <div><strong>LKP</strong>: ${session.lkp.lat.toFixed(6)}, ${session.lkp.lng.toFixed(6)}</div>
    <div><strong>K9</strong>: ${session.k9Name ?? "N/A"}</div>
    <div><strong>Handler</strong>: ${session.handlerName ?? "N/A"}</div>
    <div><strong>Requested time</strong>: ${new Date(session.requestedTime).toLocaleString()}</div>
    <div><strong>Created</strong>: ${new Date(session.createdAt).toLocaleString()}</div>
  </div>

  <h2>Weather Used</h2>
  <div class="card">${weatherLine(session.weather)}</div>

  <h2>Pooling Overlay</h2>
  <div class="card grid">
    <div><strong>Enabled</strong>: ${session.scentPoolingEnabled ? "Yes" : "No"}</div>
    <div><strong>Sensitivity</strong>: ${session.scentPoolingSensitivity}</div>
    <div><strong>Terrain Source</strong>: ${session.terrainDataSource}</div>
    <div><strong>Disclaimer</strong>: Planning/training estimate-field conditions vary.</div>
  </div>

  <h2>Training Metrics</h2>
  <div class="card grid">
    <div><strong>Min separation</strong>: ${metrics.minSeparationM.toFixed(1)} m</div>
    <div><strong>Avg separation</strong>: ${metrics.avgSeparationM.toFixed(1)} m</div>
    <div><strong>Max separation</strong>: ${metrics.maxSeparationM.toFixed(1)} m</div>
    <div><strong>Dog inside cone</strong>: ${metrics.dogInsideConePct.toFixed(1)}%</div>
    <div><strong>Track enter/exit count</strong>: ${metrics.laidTrackTransitions}</div>
  </div>

  <h2>Map Snapshot</h2>
  <img src="${mapImageDataUrl}" alt="Map snapshot" />

  <div class="disclaimer">Planning/training aid only. Field conditions vary and outputs are estimated.</div>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}
