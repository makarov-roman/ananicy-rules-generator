#!/usr/bin/env node
/**
 * Compare minReviews* (generated-from-PICS sample) vs .vendor/ananicy-rules Games/*.rules
 * Usage: node scripts/compare-vendor-generated.mjs [path-to-generated.txt]
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VENDOR_GAMES = join(ROOT, ".vendor/ananicy-rules/00-default/Games");
const DEFAULT_GEN = join(ROOT, "minReviews1000TopByOnline1000.txt");

/** Same as `src/vendor_upstream.ts` */
const STEAM_APP_PATH_RE = /\/app\/(\d{1,10})(?=\D|$)/i;
const HASH_APPID_HEAD_RE = /^\s*#\s*(\d{1,10})(?=\s*[:：])/;
const NAME_RE = /\{ "name": "([^"]+)",\s*"type":\s*"Game"\s*\}/;

function appIdFromVendorHashLine(line) {
  const url = line.match(STEAM_APP_PATH_RE);
  if (url) return +url[1];
  const head = line.match(HASH_APPID_HEAD_RE);
  if (head) return +head[1];
  return null;
}

function parseGenerated(text) {
  /** @type {Map<number, { title: string, wine: Set<string>, native: Set<string> }>} */
  const map = new Map();
  const lines = text.split("\n");
  let cur = null;
  let section = null;

  for (const line of lines) {
    const h = line.match(/^# (\d+): (.+)/);
    if (h) {
      const appid = +h[1];
      cur = { title: h[2], wine: new Set(), native: new Set() };
      map.set(appid, cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("## Wine")) {
      section = "wine";
      continue;
    }
    if (line.startsWith("## Native")) {
      section = "native";
      continue;
    }
    const m = line.match(NAME_RE);
    if (m && section) {
      cur[section].add(m[1]);
    }
  }
  return map;
}

function collectVendorRules() {
  /** @type {Map<number, { wine: Set<string>, native: Set<string> }>} */
  const map = new Map();

  function ensure(appid) {
    if (!map.has(appid))
      map.set(appid, { wine: new Set(), native: new Set() });
    return map.get(appid);
  }

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.endsWith(".rules")) continue;

      const isNative = p.includes("/linux-native/");
      const isWine = p.includes("/wine_proton/");
      const plat = isNative ? "native" : isWine ? "wine" : null;
      if (!plat) continue;

      const text = readFileSync(p, "utf8");

      let headerAppIds = [];
      let prevLine = "start";

      for (const line of text.split("\n")) {
        if (line.trim() === "") {
          headerAppIds = [];
          prevLine = "blank";
          continue;
        }
        if (line.startsWith("#")) {
          if (line.startsWith("##")) continue;

          const parsed = appIdFromVendorHashLine(line);
          if (parsed !== null) {
            if (
              prevLine === "start" ||
              prevLine === "blank" ||
              prevLine === "json" ||
              prevLine === "other"
            ) {
              headerAppIds = [parsed];
            } else if (prevLine === "hash") {
              headerAppIds.push(parsed);
            }
            prevLine = "hash";
          }
          continue;
        }
        if (line.trimStart().startsWith("{")) {
          const m = line.match(NAME_RE);
          if (m) {
            for (const appid of headerAppIds) {
              ensure(appid)[plat].add(m[1]);
            }
            headerAppIds = [];
            prevLine = "json";
          } else {
            prevLine = "json";
          }
          continue;
        }
        prevLine = "other";
        headerAppIds = [];
      }
    }
  }

  walk(VENDOR_GAMES);
  return map;
}

function setSymDiff(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA, onlyB };
}

/** Print one side as ananicy-style JSON lines (sorted). */
function printRuleSet(indent, label, bins) {
  const pad = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  console.log(`${pad}${label}`);
  const list = [...bins].sort();
  if (list.length === 0) {
    console.log(`${pad2}(none)`);
    return;
  }
  for (const name of list) {
    console.log(`${pad2}{ "name": ${JSON.stringify(name)}, "type": "Game" }`);
  }
}

const argvFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const genPath = argvFiles[0] || DEFAULT_GEN;
let genText;
try {
  genText = readFileSync(genPath, "utf8");
} catch (e) {
  console.error("Cannot read generated file:", genPath, e.message);
  process.exit(1);
}

const generated = parseGenerated(genText);
let vendor;
try {
  vendor = collectVendorRules();
} catch (e) {
  console.error("Cannot read vendor rules. Clone:", VENDOR_GAMES, e.message);
  process.exit(1);
}

const mismatches = [];

for (const [appid, g] of generated) {
  const hasGen = g.wine.size + g.native.size > 0;
  if (!hasGen) continue;

  const v = vendor.get(appid);
  if (!v) continue;

  const hasVen = v.wine.size + v.native.size > 0;
  if (!hasVen) continue;

  const wDiff = setSymDiff(g.wine, v.wine);
  const nDiff = setSymDiff(g.native, v.native);
  if (wDiff.onlyA.length || wDiff.onlyB.length || nDiff.onlyA.length || nDiff.onlyB.length) {
    mismatches.push({ appid, title: g.title, gen: g, ven: v });
  }
}

mismatches.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

const quiet = process.argv.includes("--quiet") || process.env.QUIET === "1";
if (!quiet) {
  console.error(`# ${genPath} | vendor appids: ${vendor.size} | mismatches: ${mismatches.length}\n`);
}

for (const m of mismatches) {
  console.log(`--- ${m.appid}: ${m.title}`);
  console.log("  ## Wine");
  printRuleSet(4, "### generated", m.gen.wine);
  printRuleSet(4, "### vendor", m.ven.wine);
  console.log("  ## Native");
  printRuleSet(4, "### generated", m.gen.native);
  printRuleSet(4, "### vendor", m.ven.native);
  console.log("");
}
