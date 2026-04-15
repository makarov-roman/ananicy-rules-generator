import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** `/app/<digits>` then a non-digit or end — full app id, not a prefix of a longer number. */
const STEAM_APP_PATH_RE = /\/app\/(\d{1,10})(?=\D|$)/i;

/**
 * `# 273110: Title` — one digit run after `#`, must be followed (after optional space) by `:` only.
 * Does not match a *substring* of a longer id: `# 9273110:` captures 9273110, not 273110 inside it.
 */
const HASH_APPID_HEAD_RE = /^\s*#\s*(\d{1,10})(?=\s*[:：])/;
/** Upstream sometimes omits the space before `}`: `"type": "Game"}`. */
const NAME_RE = /\{ "name": "([^"]+)",\s*"type":\s*"Game"\s*\}/;

/** Exported for tests — Steam `/app/<id>/` in URL, or `# 12345: title`. */
export function appIdFromVendorHashLine(line: string): number | null {
  const url = line.match(STEAM_APP_PATH_RE);
  if (url) return +url[1];
  const head = line.match(HASH_APPID_HEAD_RE);
  if (head) return +head[1];
  return null;
}

export type VendorRuleBins = { wine: Set<string>; native: Set<string> };

/**
 * Parses one vendor `.rules` file body (wine or native). Same logic as
 * `scripts/compare-vendor-generated.mjs` — exported for tests.
 */
export function applyVendorRulesLines(
  text: string,
  plat: "wine" | "native",
  map: Map<number, VendorRuleBins>,
): void {
  function ensure(appid: number) {
    if (!map.has(appid)) map.set(appid, { wine: new Set(), native: new Set() });
    return map.get(appid)!;
  }

  let headerAppIds: number[] = [];
  type PrevLine = "start" | "blank" | "hash" | "json" | "other";
  let prevLine: PrevLine = "start";

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

/** Same layout as `scripts/compare-vendor-generated.mjs` collectVendorRules. */
function collectVendorRules(vendorGamesDir: string) {
  const map = new Map<number, { wine: Set<string>; native: Set<string> }>();

  function walk(dir: string) {
    let entries: string[];
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
      applyVendorRulesLines(text, plat, map);
    }
  }

  walk(vendorGamesDir);
  return map;
}

/**
 * Steam appids that already have at least one Wine or Native Game rule in upstream
 * (CachyOS/ananicy-rules checkout under `.vendor/ananicy-rules`).
 */
export function upstreamDefinedAppIds(
  vendorGamesDir: string,
): Set<number> {
  const vendor = collectVendorRules(vendorGamesDir);
  const ids = new Set<number>();
  for (const [appid, v] of vendor) {
    if (v.wine.size + v.native.size > 0) ids.add(appid);
  }
  return ids;
}

export const DEFAULT_VENDOR_GAMES_DIR = join(
  import.meta.dirname!,
  "..",
  ".vendor",
  "ananicy-rules",
  "00-default",
  "Games",
);
