import SteamUser from "steam-user";
import { getDb } from "./db";

const BATCH_SIZE = 500;

export async function fetchPics() {
  const db = getDb();

  const appids: number[] = db
    .prepare(
      `SELECT t.appid FROM title t
       LEFT JOIN launch_option lo ON lo.appid = t.appid
       WHERE lo.appid IS NULL`
    )
    .all()
    .map((row: any) => row.appid);

  if (appids.length === 0) {
    console.log("No new titles to fetch. All appids already have launch options.");
    db.close();
    return;
  }

  console.log(`Found ${appids.length} titles without launch options. Connecting to Steam...`);

  const client = new SteamUser();
  console.log("Logging on to Steam anonymously...");
  client.logOn({ anonymous: true });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Steam login timed out after 30s")), 30_000);
    client.on("loggedOn", () => {
      clearTimeout(timeout);
      console.log("Logged on to Steam.");
      resolve();
    });
    client.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const insert = db.prepare(
    "INSERT INTO launch_option (appid, platform, bin) VALUES (?, ?, ?)"
  );
  const deleteTitle = db.prepare("DELETE FROM title WHERE appid = ?");

  let totalOptions = 0;
  let gamesKept = 0;
  let filtered = 0;

  for (let i = 0; i < appids.length; i += BATCH_SIZE) {
    const batch = appids.slice(i, i + BATCH_SIZE);
    console.log(
      `Fetching PICS batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(appids.length / BATCH_SIZE)} (${batch.length} apps)...`
    );

    const result = await client.getProductInfo(batch, [], true);
    const apps = result.apps;

    const insertBatch = db.transaction(() => {
      for (const [appidStr, info] of Object.entries(apps) as [string, any][]) {
        const appid = parseInt(appidStr);
        const appData = info.appinfo;
        const type = appData?.common?.type?.toLowerCase();

        if (type !== "game") {
          deleteTitle.run(appid);
          filtered++;
          continue;
        }

        const launchEntries = appData?.config?.launch;
        if (!launchEntries) {
          continue;
        }

        let hasOptions = false;
        for (const entry of Object.values(launchEntries) as any[]) {
          const executable = entry.executable;
          if (!executable) continue;

          const oslist = entry.config?.oslist ?? "windows";
          const platforms = oslist.split(",");
          const bin = executable.split(/[/\\]/).pop()!;

          for (const platform of platforms) {
            insert.run(appid, platform.trim(), bin);
            totalOptions++;
            hasOptions = true;
          }
        }

        if (hasOptions) gamesKept++;
      }
    });
    insertBatch();
  }

  client.logOff();
  db.close();

  console.log(
    `Done. ${gamesKept} games with ${totalOptions} launch options. ${filtered} non-game entries removed.`
  );
}
