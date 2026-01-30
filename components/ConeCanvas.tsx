import React, { useEffect, useRef } from "react";
import {
  computeCone,
  defaultHalfAngleDegFromMph,
  mpsToMph,
  WindData,
} from "@/lib/cone";

type Props = {
  width: number;
  height: number;
  srcPoint: { x: number; y: number } | null;
  wind: WindData | null;
  lengthPx: number;
  halfAngleDeg: number | "auto";
  label?: string;
  onClick?: (pt: { x: number; y: number }) => void;
  backgroundImage?: HTMLImageElement | null; // screenshot mode
};

export default function ConeCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, props.width, props.height);

    // optional background image (screenshot mode)
    if (props.backgroundImage) {
      ctx.drawImage(props.backgroundImage, 0, 0, props.width, props.height);
    }

    if (!props.srcPoint) return;

    // draw source marker even if no wind yet
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(props.srcPoint.x, props.srcPoint.y, 7, 0, Math.PI * 2);
    ctx.fill();

    if (!props.wind) return;

    const mph = mpsToMph(props.wind.wind_speed_mps);
    const halfAngle =
      props.halfAngleDeg === "auto"
        ? defaultHalfAngleDegFromMph(mph)
        : props.halfAngleDeg;

    const g = computeCone(
      props.srcPoint,
      props.lengthPx,
      halfAngle,
      props.wind.wind_dir_from_deg
    );

    // gradient fill
    const grad = ctx.createRadialGradient(
      props.srcPoint.x,
      props.srcPoint.y,
      10,
      props.srcPoint.x,
      props.srcPoint.y,
      props.lengthPx
    );
    grad.addColorStop(0.0, "rgba(255, 80, 0, 0.42)");
    grad.addColorStop(0.6, "rgba(255, 170, 0, 0.26)");
    grad.addColorStop(1.0, "rgba(255, 230, 120, 0.10)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.left.x, g.left.y);
    ctx.lineTo(g.tip.x, g.tip.y);
    ctx.lineTo(g.right.x, g.right.y);
    ctx.closePath();
    ctx.fill();

    // centerline
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 6;
    ctx.setLineDash([18, 14]);
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.tip.x, g.tip.y);
    ctx.stroke();

    // edges
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.left.x, g.left.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(props.srcPoint.x, props.srcPoint.y);
    ctx.lineTo(g.right.x, g.right.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // label
    const speedStr = `${mph.toFixed(1)} mph`;
    const from = Math.round(props.wind.wind_dir_from_deg);
    const down = Math.round(g.downwindDeg);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(12, 12, 460, 72);
    ctx.fillStyle = "white";
    ctx.font = "18px system-ui";
    ctx.fillText(`Wind from ${from}° @ ${speedStr}  → downwind ${down}°`, 20, 40);
    ctx.font = "14px system-ui";
    ctx.fillText(props.label || "Probable scent cone (planning estimate)", 20, 64);
  }, [
    props.width,
    props.height,
    props.srcPoint,
    props.wind,
    props.lengthPx,
    props.halfAngleDeg,
    props.label,
    props.backgroundImage,
  ]);

  return (
    <canvas
      ref={ref}
      width={props.width}
      height={props.height}
      style={{
        width: "100%",
        height: "100%",
        cursor: props.onClick ? "crosshair" : "default",
        borderRadius: 10,
      }}
      onClick={(e) => {
        if (!props.onClick) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * props.width;
        const y = ((e.clientY - rect.top) / rect.height) * props.height;
        props.onClick({ x, y });
      }}
    />
  );
}

export function downloadCanvasPNG(
  canvas: HTMLCanvasElement,
  filename = "scent_cone.png"
) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}
export function downloadCanvasPNG_ICS(
  canvas: HTMLCanvasElement,
  filename: string,
  meta: {
    incidentName?: string;
    operationPeriod?: string;
    notes?: string;
    lat?: number;
    lon?: number;
    windSource?: string;
    windFromDeg?: number;
    windSpeedMps?: number;
    windSpeedMph?: number;
    timeLocal?: string;
    timeUtc?: string;
    coneLengthPx?: number;
    coneHalfAngleDeg?: number | "auto";
  }
) {
  // Create a copy canvas so we don’t permanently draw the footer on-screen
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height + 180; // add footer space
  const ctx = out.getContext("2d");
  if (!ctx) return;

  // Draw original image
  ctx.drawImage(canvas, 0, 0);

  // Footer background
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, canvas.height, out.width, 180);

  // Text
  ctx.fillStyle = "white";
  ctx.font = "18px system-ui";
  ctx.fillText("ICS Scent Cone Planning Export (Decision Support)", 16, canvas.height + 28);

  ctx.font = "14px system-ui";
  const line1 = `Local Time: ${meta.timeLocal ?? "n/a"}   |   UTC: ${meta.timeUtc ?? "n/a"}   |   Wind Source: ${meta.windSource ?? "n/a"}`;
  ctx.fillText(line1, 16, canvas.height + 55);

  const windStr =
    meta.windFromDeg != null
      ? `Wind FROM: ${Math.round(meta.windFromDeg)}°`
      : "Wind FROM: n/a";
  const speedStr =
    meta.windSpeedMph != null
      ? `${meta.windSpeedMph.toFixed(1)} mph`
      : meta.windSpeedMps != null
      ? `${meta.windSpeedMps.toFixed(2)} m/s`
      : "n/a";

  const line2 = `Location: ${meta.lat?.toFixed(6) ?? "n/a"}, ${meta.lon?.toFixed(6) ?? "n/a"}   |   ${windStr} @ ${speedStr}`;
  ctx.fillText(line2, 16, canvas.height + 78);

  const coneStr = `Cone: length=${meta.coneLengthPx ?? "n/a"}px   half-angle=${meta.coneHalfAngleDeg ?? "n/a"}`;
  ctx.fillText(coneStr, 16, canvas.height + 101);

  // Notes block
  ctx.font = "13px system-ui";
  const notes = meta.notes?.trim() ? meta.notes.trim() : "(no notes)";
  ctx.fillText(`Notes: ${notes}`.slice(0, 140), 16, canvas.height + 124);

  // Disclaimer
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("Disclaimer: This is a planning estimate only. Terrain/thermals/obstacles can significantly alter scent behavior.", 16, canvas.height + 154);

  // Download
  const a = document.createElement("a");
  a.download = filename;
  a.href = out.toDataURL("image/png");
  a.click();
}

