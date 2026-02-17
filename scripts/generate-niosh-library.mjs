import { writeFile } from "node:fs/promises";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const BASE = "https://www.cdc.gov/niosh/npg/";
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

function stripTags(value) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#174;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeTs(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseCardMap(html) {
  const cardRegex = /<div class=["']card-title h6["']>([\s\S]*?)<\/div>\s*<div class=["']card-body["']>\s*<div class=["']card-text["']>([\s\S]*?)<\/div>/gi;
  const map = new Map();
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    map.set(stripTags(match[1]).toLowerCase(), stripTags(match[2]));
  }
  return map;
}

function inferFlags(name, synonyms, description) {
  const lower = `${name} ${synonyms.join(" ")} ${description}`.toLowerCase();
  return {
    strongBase: /\b(ammonia|amine|amino|hydroxide|caustic soda|alkali)\b/.test(lower) || undefined,
    hydrocarbon: /\b(alkane|alkene|alkyne|benzene|toluene|xylene|naphtha|gasoline|diesel|petroleum|hydrocarbon)\b/.test(lower) || undefined,
    oxygenatedVoc: /\b(alcohol|ketone|aldehyde|ether|ester|acetate|acrylate|glycol|epoxy)\b/.test(lower) || undefined,
    canDisplaceOxygen: /(simple asphyxiant|asphyxiant|oxygen deficiency|displace oxygen)/.test(lower) || undefined,
    flammable: /(flammable|flash point|combustible)/.test(lower) || undefined,
    oxidizer: /\b(oxidizer|oxidizing agent)\b/.test(lower) || undefined,
    corrosive: /(corrosive|causes burns|severe burns|skin burns|eye burns)/.test(lower) || undefined,
  };
}

function inferExpected(name, flags) {
  const lower = name.toLowerCase();
  let pid = "unknown";
  let fid = "unknown";
  if (flags.hydrocarbon || flags.oxygenatedVoc) {
    pid = "high";
    fid = "high";
  } else if (flags.flammable) {
    fid = "medium";
  } else if (flags.canDisplaceOxygen) {
    pid = "none";
    fid = "none";
  }

  let ph = "unknown";
  if (/\bacid\b|hydrogen fluoride|hydrogen chloride|hydrogen bromide/.test(lower)) ph = "acidic";
  if (flags.strongBase) ph = "basic";

  return {
    pid,
    fid,
    ph,
    oxidizerPositive: flags.oxidizer ? true : undefined,
    lelBehavior: flags.flammable ? "strong" : "none",
  };
}

function parseIdlhPpm(idlhText) {
  if (!idlhText) return 1000000;
  const lower = idlhText.toLowerCase();
  const ppmMatch = lower.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*ppm/);
  if (ppmMatch) return Number(ppmMatch[1].replace(/,/g, ""));
  const genericNum = lower.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (genericNum) return Number(genericNum[1].replace(/,/g, ""));
  return 1000000;
}

function parseSynonyms(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.replace(/\[.*?\]/g, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function fetchText(url) {
  let lastError = null;
  for (let i = 0; i < MAX_RETRIES; i += 1) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

async function gatherChemicalLinks() {
  const links = new Set();
  for (const letter of LETTERS) {
    const html = await fetchText(`${BASE}npgsyn-${letter}.html`);
    const matches = html.matchAll(/href=['"](npgd\d{4}\.html)['"]/gi);
    for (const match of matches) links.add(match[1].toLowerCase());
  }
  return [...links].sort();
}

function toRecord(path, html) {
  const cards = parseCardMap(html);
  const nameMatch = html.match(/<h1 id="content">([\s\S]*?)<\/h1>/i);
  const name = stripTags(nameMatch?.[1] || path.replace(".html", ""));
  const synonyms = parseSynonyms(cards.get("synonyms & trade names"));
  const idlhPpm = parseIdlhPpm(cards.get("idlh") || "");
  const cas = cards.get("cas no.") || "";
  const dot = cards.get("dot id & guide") || "";

  const metaDescription = stripTags(html.match(/<meta name=\"description\" content=\"([^\"]*)\"/i)?.[1] || "");
  const flags = inferFlags(name, synonyms, metaDescription);
  const expected = inferExpected(name, flags);

  const firstDot = dot.split(" ")[0] || "";
  const unNa = /^\d{4}$/.test(firstDot) ? firstDot : undefined;
  const ergGuide = dot.match(/\b(\d{3})\b/)?.[1];
  const code = path.match(/npgd(\d{4})\.html/i)?.[1] || "0000";

  return {
    id: `${slugify(name)}-${code}`,
    name,
    synonyms,
    unNa,
    ergGuide,
    idlhPpm,
    npgPage: code,
    cas,
    flags,
    expected,
  };
}

function toTs(records) {
  const lines = [
    'import { ChemicalRecord } from "./types";',
    "",
    "export const CHEMICAL_LIBRARY: ChemicalRecord[] = [",
  ];

  for (const rec of records) {
    lines.push("  {");
    lines.push(`    id: "${escapeTs(rec.id)}",`);
    lines.push(`    name: "${escapeTs(rec.name)}",`);
    lines.push(`    synonyms: [${rec.synonyms.map((s) => `"${escapeTs(s)}"`).join(", ")}],`);
    if (rec.unNa) lines.push(`    unNa: "${escapeTs(rec.unNa)}",`);
    if (rec.ergGuide) lines.push(`    ergGuide: "${escapeTs(rec.ergGuide)}",`);
    lines.push(`    idlhPpm: ${Number.isFinite(rec.idlhPpm) ? rec.idlhPpm : 1000000},`);
    lines.push(`    npgPage: "${escapeTs(rec.npgPage)}",`);

    const flags = Object.entries(rec.flags)
      .filter(([, value]) => value === true)
      .map(([key]) => `${key}: true`)
      .join(", ");
    lines.push(`    flags: {${flags}},`);

    const exp = [`pid: "${rec.expected.pid}"`, `fid: "${rec.expected.fid}"`, `ph: "${rec.expected.ph}"`];
    if (rec.expected.oxidizerPositive) exp.push("oxidizerPositive: true");
    exp.push(`lelBehavior: "${rec.expected.lelBehavior}"`);
    lines.push(`    expected: { ${exp.join(", ")} },`);
    lines.push("  },");
  }

  lines.push("];", "");
  return lines.join("\n");
}

async function main() {
  const links = await gatherChemicalLinks();
  const records = [];

  for (const [idx, path] of links.entries()) {
    try {
      const html = await fetchText(`${BASE}${path}`);
      records.push(toRecord(path, html));
    } catch (err) {
      console.error(`Skipping ${path}: ${String(err)}`);
    }
    if ((idx + 1) % 100 === 0) {
      console.log(`Fetched ${idx + 1}/${links.length} detail pages...`);
    }
  }

  const byName = new Map();
  for (const rec of records) {
    if (!byName.has(rec.id)) byName.set(rec.id, rec);
  }

  const unique = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  await writeFile("hazmat-core/src/data.ts", toTs(unique), "utf8");
  console.log(`Generated hazmat-core/src/data.ts with ${unique.length} unique NIOSH entries (from ${links.length} links).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
