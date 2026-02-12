import type { AppProps } from "next/app";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Clean up any previously registered service worker from older app versions.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      .catch(() => {});
  }, []);

  return <Component {...pageProps} />;
}
