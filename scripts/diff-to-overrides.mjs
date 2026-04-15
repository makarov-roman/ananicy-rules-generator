#!/usr/bin/env node
/**
 * Parse compare output (diff.txt) and merge ### vendor rule names into generate_conf.yaml overrides.
 * Usage: node scripts/diff-to-overrides.mjs [diff.txt] [generate_conf.yaml]
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function parseRuleLine(line) {
  const needle = '"name": "';
  const idx = line.indexOf(needle);
  if (idx === -1) return null;
  let i = idx + needle.length;
  let out = "";
  while (i < line.length) {
    const c = line[i];
    if (c === "\\") {
      if (i + 1 < line.length) {
        out += line[i + 1];
        i += 2;
      } else i++;
      continue;
    }
    if (c === '"') return out;
    out += c;
    i++;
  }
  return null;
}

function parseDiffVendorNames(text) {
  /** @type {Map<number, { title: string, names: Set<string> }>} */
  const blocks = new Map();
  let appid = null;
  let title = "";
  let names = null;
  let inVendor = false;

  function flush() {
    if (appid != null && names != null) {
      blocks.set(appid, { title, names });
    }
  }

  for (const line of text.split("\n")) {
    const h = line.match(/^--- (\d+): (.+)$/);
    if (h) {
      flush();
      appid = +h[1];
      title = h[2].replace(/\s*\[(generated|manual)]\s*$/, "").trim();
      names = new Set();
      inVendor = false;
      continue;
    }
    if (appid == null) continue;

    if (/^\s+### generated\s*$/.test(line)) {
      inVendor = false;
      continue;
    }
    if (/^\s+### vendor\s*$/.test(line)) {
      inVendor = true;
      continue;
    }
    if (/^\s+## (Wine|Native)\s*$/.test(line)) {
      inVendor = false;
      continue;
    }

    if (inVendor) {
      if (/^\s+\(none\)\s*$/.test(line)) continue;
      const n = parseRuleLine(line);
      if (n) names.add(n);
    }
  }
  flush();
  return blocks;
}

function loadExistingDoc(path) {
  try {
    const parsed = parseYaml(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function loadExistingOverrides(doc) {
  const raw = doc?.overrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  /** @type {Map<number, Set<string>>} */
  const m = new Map();
  for (const [k, v] of Object.entries(raw)) {
    const id = parseInt(String(k), 10);
    if (Number.isNaN(id)) continue;
    const list = Array.isArray(v) ? v : [];
    m.set(id, new Set(list.filter((x) => typeof x === "string")));
  }
  return m;
}

const diffPath = process.argv[2] || join(ROOT, "diff.txt");
const confPath = process.argv[3] || join(ROOT, "generate_conf.yaml");

const diffText = readFileSync(diffPath, "utf8");
const fromDiff = parseDiffVendorNames(diffText);
const existingDoc = loadExistingDoc(confPath);
const merged = loadExistingOverrides(existingDoc);

for (const [appid, { names }] of fromDiff) {
  if (!merged.has(appid)) merged.set(appid, new Set());
  const s = merged.get(appid);
  for (const n of names) s.add(n);
}

const appids = [...merged.keys()].sort((a, b) => a - b);
const nextOverrides = {};
for (const appid of appids) {
  const names = [...merged.get(appid)].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  nextOverrides[String(appid)] = names;
}
existingDoc.overrides = nextOverrides;
writeFileSync(confPath, stringifyYaml(existingDoc), "utf8");
console.error(
  `Wrote ${confPath}: preserved existing keys and merged overrides for ${appids.length} appids (${fromDiff.size} diff blocks).`,
);
