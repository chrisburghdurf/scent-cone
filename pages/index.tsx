import React, { useEffect, useState } from "react";
import Head from "next/head";
import LiveMap from "@/components/LiveMap";
import ScreenshotMode from "@/components/ScreenshotMode";

export default function Home() {
  const [tab, setTab] = useState<"live" | "screenshot">("live");

  // Register service worker (PWA/offline shell)
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }
  }, []);

  return (
    <>
      <Head>
        <title>Scent Cone Overlay</title>
        <meta
          name="description"
          content="Scent cone visualization and probability envelope for operational planning."
        />

        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0b1220" />

        {/* Icons */}
        <link rel="icon" href="/favicon.ico" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon-v2.png"
        />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />

        {/* Mobile viewport */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <main
        style={{
          padding: 18,
          minHeight: "100vh",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        }}
      >
        {/* Glass card wrapper for readability over background */}
        <div
          style={{
            maxWidth: 1250,
            margin: "0 auto",
            background: "rgba(255,255,255,0.92)",
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            backdropFilter: "blur(6px)",
          }}
        >
          {/* Header with logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <img
              src="/app-logo.png"
              alt="Scent Cone App Logo"
              style={{
                width: 56,
                height: 56,
                objectFit: "contain",
              }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ margin: 0 }}>Scent Cone Overlay</h1>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
                Decision-support for scent dispersion planning (not route prediction)
              </p>
            </div>
          </div>

          {/* Tabs */}
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
        </div>
      </main>
    </>
  );
}
