import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { getDb } from "./db";
import { binPassesFilters, type FilterId, isKnownFilterId } from "./generate_filters";

/** Default config file next to package root */
const DEFAULT_GENERATE_CONF_PATH = join(
  import.meta.dirname!,
  "..",
  "generate_conf.yaml",
);

interface GenerateConfYaml {
  filters?: unknown;
  /** Steam appid → process basenames that replace auto-generated rules for that app */
  overrides?: unknown;
}

export type OverridesMap = Map<number, string[]>;

interface GameEntry {
  name: string;
  wine: Set<string>;
  native: Set<string>;
}

function loadGenerateYaml(
  filePath: string,
): { filters: Set<FilterId>; overrides: OverridesMap } {
  const raw = readFileSync(filePath, "utf8");
  const doc = parse(raw) as GenerateConfYaml;

  const filters = new Set<FilterId>();
  const list = Array.isArray(doc.filters) ? doc.filters : [];

  for (const entry of list) {
    if (typeof entry !== "string") {
      console.warn("generate: skip non-string filter entry");
      continue;
    }
    if (!isKnownFilterId(entry)) {
      console.warn(`generate: unknown filter "${entry}", ignoring`);
      continue;
    }
    filters.add(entry);
  }

  const overrides: OverridesMap = new Map();
  const ov = doc.overrides;
  if (ov !== undefined && ov !== null && typeof ov === "object" && !Array.isArray(ov)) {
    for (const [key, value] of Object.entries(ov as Record<string, unknown>)) {
      const appid = parseInt(String(key), 10);
      if (Number.isNaN(appid)) {
        console.warn(`generate: overrides: skip non-numeric app id "${key}"`);
        continue;
      }
      if (!Array.isArray(value)) {
        console.warn(`generate: overrides[${appid}]: expected array, skipping`);
        continue;
      }
      const names = value.filter((x): x is string => typeof x === "string" && x.length > 0);
      if (names.length > 0) overrides.set(appid, names);
    }
  }

  return { filters, overrides };
}

/** Routes override basenames to Wine (.exe) vs Native (everything else). */
function addOverrideBin(game: GameEntry, bin: string) {
  if (bin.toLowerCase().endsWith(".exe")) {
    game.wine.add(bin);
  } else {
    game.native.add(bin);
  }
}

/** Appids whose rules were replaced from `overrides` (subset of yaml keys). */
function applyOverrides(
  games: Map<number, GameEntry>,
  overrides: OverridesMap,
  queriedApps: Map<number, string>,
): Set<number> {
  const applied = new Set<number>();
  for (const [appid, names] of overrides) {
    if (!queriedApps.has(appid)) {
      console.warn(
        `generate: overrides for appid ${appid} ignored (not in this generate run)`,
      );
      continue;
    }
    const existing = games.get(appid);
    const game: GameEntry = {
      name: existing?.name ?? queriedApps.get(appid)!,
      wine: new Set(),
      native: new Set(),
    };
    for (const bin of names) {
      addOverrideBin(game, bin);
    }
    games.set(appid, game);
    applied.add(appid);
  }
  return applied;
}

/** Drop entries with nothing to emit (e.g. empty override list not possible today, but safe). */
function removeGamesWithNoBins(games: Map<number, GameEntry>) {
  for (const [appid, g] of games) {
    if (g.wine.size === 0 && g.native.size === 0) {
      games.delete(appid);
    }
  }
}

interface Row {
  appid: number;
  name: string;
  platform: string;
  bin: string;
}

export interface GenerateOptions {
  minReviews?: number;
  topWeekly?: number;
  /** Path to generate_conf.yaml; default is repo-root generate_conf.yaml if it exists */
  configPath?: string;
}

export function generate(opts: GenerateOptions = {}) {
  if (opts.configPath && !existsSync(opts.configPath)) {
    console.error(`Config not found: ${opts.configPath}`);
    process.exit(1);
  }

  const confPath = opts.configPath ?? DEFAULT_GENERATE_CONF_PATH;
  const { filters, overrides } = existsSync(confPath)
    ? loadGenerateYaml(confPath)
    : { filters: new Set<FilterId>(), overrides: new Map<number, string[]>() };

  const db = getDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.minReviews) {
    conditions.push("t.reviews >= ?");
    params.push(opts.minReviews);
  }

  if (opts.topWeekly) {
    conditions.push(
      "t.appid IN (SELECT appid FROM title ORDER BY median2weeks DESC LIMIT ?)",
    );
    params.push(opts.topWeekly);
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const rows: Row[] = db
    .prepare(
      `SELECT DISTINCT t.appid, t.name, lo.platform, lo.bin
       FROM title t
       JOIN launch_option lo ON lo.appid = t.appid
       WHERE 1=1 ${where}
       ORDER BY t.name COLLATE NOCASE, lo.bin`,
    )
    .all(...params) as Row[];

  db.close();

  if (rows.length === 0) {
    console.log("No data. Run fetch-spy and fetch-pics first.");
    return;
  }

  /** Every appid that had at least one launch row in this query */
  const queriedApps = new Map<number, string>();
  for (const row of rows) {
    queriedApps.set(row.appid, row.name);
  }

  // Group by appid (only apps with ≥1 bin after filters)
  const games = new Map<number, GameEntry>();

  for (const row of rows) {
    if (!binPassesFilters(row.bin, filters)) continue;

    if (!games.has(row.appid)) {
      games.set(row.appid, {
        name: row.name,
        wine: new Set(),
        native: new Set(),
      });
    }
    const game = games.get(row.appid)!;
    if (row.platform === "linux") {
      game.native.add(row.bin);
    } else if (row.platform === "windows") {
      game.wine.add(row.bin);
    }
  }

  const manualAppIds = applyOverrides(games, overrides, queriedApps);
  removeGamesWithNoBins(games);

  const noRules = [...queriedApps.entries()]
    .filter(([appid]) => !games.has(appid))
    .sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" }),
    );

  const sortedRules = [...games.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name, undefined, { sensitivity: "base" }),
  );

  const generatedRules = sortedRules.filter(([appid]) => !manualAppIds.has(appid));
  const overriddenRules = sortedRules.filter(([appid]) => manualAppIds.has(appid));

  function emitGame(lines: string[], appid: number, game: GameEntry) {
    lines.push(`# ${appid}: ${game.name}`);
    if (game.wine.size > 0) {
      lines.push("## Wine");
      for (const bin of [...game.wine].sort()) {
        lines.push(`{ "name": "${bin}", "type": "Game" }`);
      }
    }
    if (game.native.size > 0) {
      lines.push("## Native");
      for (const bin of [...game.native].sort()) {
        lines.push(`{ "name": "${bin}", "type": "Game" }`);
      }
    }
    lines.push("");
  }

  const lines: string[] = [];

  lines.push("## Autogenerated");
  lines.push("");
  if (generatedRules.length === 0) {
    lines.push("# (none)");
    lines.push("");
  } else {
    for (const [appid, game] of generatedRules) {
      emitGame(lines, appid, game);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Overridden");
  lines.push("");
  if (overriddenRules.length === 0) {
    lines.push("# (none)");
    lines.push("");
  } else {
    for (const [appid, game] of overriddenRules) {
      emitGame(lines, appid, game);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## No automatic rules");
  lines.push("");
  lines.push(
    "# Apps with launch data in this run, but every option was removed by filters (or no binary left).",
  );
  lines.push("");

  if (noRules.length === 0) {
    lines.push("# (none)");
  } else {
    for (const [appid, name] of noRules) {
      lines.push(`# ${appid}: ${name}`);
    }
  }

  lines.push("");

  process.stdout.write(lines.join("\n"));
}
