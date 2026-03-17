import { getDb } from "./db";

interface Row {
  appid: number;
  name: string;
  platform: string;
  bin: string;
}

interface GameEntry {
  name: string;
  wine: Set<string>;
  native: Set<string>;
}

export interface GenerateOptions {
  minReviews?: number;
  topWeekly?: number;
}

export function generate(opts: GenerateOptions = {}) {
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

  // Group by appid
  const games = new Map<number, GameEntry>();

  for (const row of rows) {
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

  // Sort by name
  const sorted = [...games.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name, undefined, { sensitivity: "base" }),
  );

  const lines: string[] = [];

  for (const [appid, game] of sorted) {
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

  process.stdout.write(lines.join("\n"));
}
