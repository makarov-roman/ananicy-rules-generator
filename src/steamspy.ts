import { getDb } from "./db";

const STEAMSPY_API = "https://steamspy.com/api.php";
const RATE_LIMIT_MS = 61_000;

interface SteamSpyEntry {
  appid: number;
  name: string;
  positive: number;
  negative: number;
  median_2weeks: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchSteamSpy(startPage = 0) {
  const db = getDb();
  const insert = db.prepare(
    "INSERT OR REPLACE INTO title (appid, name, reviews, median2weeks) VALUES (?, ?, ?, ?)"
  );

  let page = startPage;
  let totalInserted = 0;

  while (true) {
    console.log(`Fetching SteamSpy page ${page}...`);
    const url = `${STEAMSPY_API}?request=all&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SteamSpy returned ${res.status} for page ${page}`);
    }

    const data: Record<string, SteamSpyEntry> = await res.json();
    const entries = Object.values(data);

    if (entries.length === 0) {
      console.log("Empty page, stopping.");
      break;
    }

    let minReviews = Infinity;
    let sumReviews = 0;
    let sumMedian = 0;

    const insertMany = db.transaction(() => {
      for (const entry of entries) {
        const reviews = entry.positive + entry.negative;
        if (reviews < minReviews) minReviews = reviews;
        sumReviews += reviews;
        sumMedian += entry.median_2weeks;
        insert.run(entry.appid, entry.name, reviews, entry.median_2weeks);
      }
    });
    insertMany();

    totalInserted += entries.length;
    const avgReviews = Math.round(sumReviews / entries.length);
    const avgMedian = Math.round(sumMedian / entries.length);
    console.log(`  Page ${page}: ${entries.length} inserted (${totalInserted} total) | min reviews: ${minReviews}, avg reviews: ${avgReviews}, avg median2weeks: ${avgMedian}`);

    page++;
    console.log(`  Rate limiting: waiting ${RATE_LIMIT_MS / 1000}s...`);
    await sleep(RATE_LIMIT_MS);
  }

  db.close();
  console.log(`Done. ${totalInserted} titles stored.`);
}
