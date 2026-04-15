import { existsSync } from "fs";
import { join } from "path";
import { getDb } from "./db";
import { binPassesFilters, type FilterId } from "./generate_filters";
import {
  DEFAULT_VENDOR_GAMES_DIR,
  upstreamDefinedAppIds,
} from "./vendor_upstream";
import {
  loadSortConfig,
  sortTitleStats,
  type TitleSteamSpyStats,
} from "./sort_config";
import {
  DEFAULT_OUTPUT_FLAGS,
  tryLoadGenerateConf,
  type OutputFlags,
  type OverridesMap,
} from "./yaml_conf";

/** Default config file next to package root */
const DEFAULT_GENERATE_CONF_PATH = join(
  import.meta.dirname!,
  "..",
  "generate_conf.yaml",
);

interface GameEntry {
  name: string;
  wine: Set<string>;
  native: Set<string>;
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
  reviews: number;
  median2weeks: number;
  platform: string;
  bin: string;
}

export interface GenerateOptions {
  minReviews?: number;
  topWeekly?: number;
  /** Path to generate_conf.yaml; default is repo-root generate_conf.yaml if it exists */
  configPath?: string;
  /** Vendor `00-default/Games` tree — used to list ## Not in upstream (full rules not yet upstream). */
  vendorGamesDir?: string;
}

export function generate(opts: GenerateOptions = {}) {
  if (opts.configPath && !existsSync(opts.configPath)) {
    console.error(`Config not found: ${opts.configPath}`);
    process.exit(1);
  }

  const confPath = opts.configPath ?? DEFAULT_GENERATE_CONF_PATH;
  const conf = tryLoadGenerateConf(confPath);
  const filters = conf?.filters ?? new Set<FilterId>();
  const overrides: OverridesMap = conf?.overrides ?? new Map<number, string[]>();
  const outputFlags: OutputFlags = conf?.output ?? { ...DEFAULT_OUTPUT_FLAGS };

  const { sortBy, sortDirection } = loadSortConfig(confPath);

  const vendorDir = opts.vendorGamesDir ?? DEFAULT_VENDOR_GAMES_DIR;
  const vendorOk = existsSync(vendorDir);
  if (!vendorOk) {
    console.warn(
      `generate: vendor Games dir not found (${vendorDir}); ## Not in upstream cannot be computed.`,
    );
  }
  const upstreamIds = vendorOk ? upstreamDefinedAppIds(vendorDir) : new Set<number>();

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
      `SELECT DISTINCT t.appid, t.name, t.reviews, t.median2weeks, lo.platform, lo.bin
       FROM title t
       JOIN launch_option lo ON lo.appid = t.appid
       WHERE 1=1 ${where}
       ORDER BY t.name COLLATE NOCASE, lo.bin`,
    )
    .all(...params) as Row[];

  db.close();

  const statsByAppId = new Map<number, { reviews: number; median2weeks: number }>();
  for (const row of rows) {
    if (!statsByAppId.has(row.appid)) {
      statsByAppId.set(row.appid, {
        reviews: row.reviews,
        median2weeks: row.median2weeks,
      });
    }
  }

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

  /** Order Autogenerated / Overridden by `generate_conf.yaml` `sort`. */
  const statsForSort: TitleSteamSpyStats[] = [];
  for (const [appid, game] of games) {
    const st = statsByAppId.get(appid);
    statsForSort.push({
      appid,
      name: game.name,
      reviews: st?.reviews ?? 0,
      median2weeks: st?.median2weeks ?? 0,
    });
  }
  const sortedByConfig = sortTitleStats(
    statsForSort,
    sortBy,
    sortDirection,
  );
  const sortedRules = sortedByConfig.map((r) => {
    const game = games.get(r.appid)!;
    return [r.appid, game] as [number, GameEntry];
  });

  const generatedRules = sortedRules.filter(([appid]) => !manualAppIds.has(appid));
  const overriddenRules = sortedRules.filter(([appid]) => manualAppIds.has(appid));

  /** Games with emitted rules whose appid is absent from vendor (same JSON as Autogenerated — contribution / diff). */
  const notInUpstreamStats: TitleSteamSpyStats[] = [];
  if (vendorOk) {
    for (const [appid, game] of games) {
      if (!upstreamIds.has(appid)) {
        const st = statsByAppId.get(appid);
        notInUpstreamStats.push({
          appid,
          name: game.name,
          reviews: st?.reviews ?? 0,
          median2weeks: st?.median2weeks ?? 0,
        });
      }
    }
  }
  const notInUpstreamSorted = sortTitleStats(
    notInUpstreamStats,
    sortBy,
    sortDirection,
  );

  function emitGame(
    lines: string[],
    appid: number,
    game: GameEntry,
    stats: { reviews: number; median2weeks: number } | undefined,
  ) {
    lines.push(`# ${appid}: ${game.name}`);
    if (stats) {
      lines.push(
        `# SteamSpy: reviews=${stats.reviews} median2weeks=${stats.median2weeks}`,
      );
    }
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

  const sections: string[][] = [];

  if (outputFlags.autogenerated) {
    const chunk: string[] = [];
    chunk.push("## Autogenerated");
    chunk.push("");
    if (generatedRules.length === 0) {
      chunk.push("# (none)");
      chunk.push("");
    } else {
      for (const [appid, game] of generatedRules) {
        emitGame(chunk, appid, game, statsByAppId.get(appid));
      }
    }
    sections.push(chunk);
  }

  if (outputFlags.overrides) {
    const chunk: string[] = [];
    chunk.push("## Overridden");
    chunk.push("");
    if (overriddenRules.length === 0) {
      chunk.push("# (none)");
      chunk.push("");
    } else {
      for (const [appid, game] of overriddenRules) {
        emitGame(chunk, appid, game, statsByAppId.get(appid));
      }
    }
    sections.push(chunk);
  }

  if (outputFlags.missing) {
    const chunk: string[] = [];
    chunk.push("## Not in upstream");
    chunk.push("");
    chunk.push(
      "# Same rules as Autogenerated where applicable, for appids not yet under the vendor tree. Order: generate_conf.yaml sort.",
    );
    chunk.push("");
    if (!vendorOk) {
      chunk.push("# (skipped — Games directory not found)");
      chunk.push("");
    } else if (notInUpstreamSorted.length === 0) {
      chunk.push("# (none — every appid in this run is already defined upstream)");
      chunk.push("");
    } else {
      for (const r of notInUpstreamSorted) {
        const game = games.get(r.appid);
        if (game) {
          emitGame(chunk, r.appid, game, statsByAppId.get(r.appid));
        }
      }
    }
    sections.push(chunk);
  }

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) {
      lines.push("---");
      lines.push("");
    }
    lines.push(...sections[i]);
  }
  const hasHeadSections = sections.length > 0;
  if (hasHeadSections && outputFlags.noAutomaticRules) {
    lines.push("---");
    lines.push("");
  }

  if (outputFlags.noAutomaticRules) {
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
        const st = statsByAppId.get(appid);
        if (st) {
          lines.push(
            `# SteamSpy: reviews=${st.reviews} median2weeks=${st.median2weeks}`,
          );
        }
      }
    }

    lines.push("");
  }

  process.stdout.write(lines.join("\n"));
}
