import { PointSample } from "@/lib/types";

function textOf(el: Element, tagName: string): string | undefined {
  const tag = el.getElementsByTagName(tagName)[0];
  if (!tag?.textContent) return undefined;
  return tag.textContent.trim();
}

export function parseGpx(content: string): PointSample[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, "application/xml");

  const points: PointSample[] = [];
  const trkpts = Array.from(xml.getElementsByTagName("trkpt"));
  trkpts.forEach((node) => {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const ts = textOf(node, "time");
    points.push({ lat, lng, ts });
  });

  if (points.length) return points;

  const rtepts = Array.from(xml.getElementsByTagName("rtept"));
  rtepts.forEach((node) => {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const ts = textOf(node, "time");
    points.push({ lat, lng, ts });
  });

  return points;
}

export function buildGpx(trackName: string, points: PointSample[]): string {
  const safeName = trackName.replace(/[<>]/g, "").trim() || "Track";
  const body = points
    .map((p) => {
      const time = p.ts ? `<time>${new Date(p.ts).toISOString()}</time>` : "";
      return `<trkpt lat="${p.lat}" lon="${p.lng}">${time}</trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SAR Scent Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${safeName}</name>
    <trkseg>
      ${body}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
