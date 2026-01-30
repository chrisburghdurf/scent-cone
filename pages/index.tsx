import React, { useState } from "react";
import LiveMap from "@/components/LiveMap";
import ScreenshotMode from "@/components/ScreenshotMode";

export default function Home() {
  const [tab, setTab] = useState<"live" | "screenshot">("live");

  return (
    <main style={{ padding: 18, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
      <h1 style={{ marginBottom: 6 }}>Scent Cone Overlay</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        Neutral basemap + Windy wind data. Planning estimate only.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setTab("live")}
          style={{
            padding: 10,
            borderRadius: 10,
            flex: 1,
            border: "1px solid #e5e7eb",
            background: tab === "live" ? "#111827" : "white",
            color: tab === "live" ? "white" : "black",
          }}
        >
          Live Map
        </button>
        <button
          onClick={() => setTab("screenshot")}
          style={{
            padding: 10,
            borderRadius: 10,
            flex: 1,
            border: "1px solid #e5e7eb",
            background: tab === "screenshot" ? "#111827" : "white",
            color: tab === "screenshot" ? "white" : "black",
          }}
        >
          Screenshot Mode
        </button>
      </div>

      {tab === "live" ? <LiveMap /> : <ScreenshotMode />}
    </main>
  );
}

