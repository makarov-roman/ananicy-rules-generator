export {};

function parseArg(args: string[], flag: string): number | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return parseInt(args[idx + 1]);
}

function parseStringArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const command = process.argv[2];

switch (command) {
  case "fetch-spy": {
    const startPage = process.argv[3] ? parseInt(process.argv[3]) : 0;
    const { fetchSteamSpy } = await import("./steamspy");
    await fetchSteamSpy(startPage);
    break;
  }
  case "fetch-pics": {
    const { fetchPics } = await import("./pics");
    await fetchPics();
    break;
  }
  case "generate": {
    const args = process.argv.slice(3);
    const minReviews = parseArg(args, "--min-reviews");
    const topWeekly = parseArg(args, "--top-weekly");
    const configPath = parseStringArg(args, "--config");
    const { generate } = await import("./generate");
    generate({ minReviews, topWeekly, configPath });
    break;
  }
  default:
    console.log(
      "Usage: npx tsx src/index.ts <fetch-spy|fetch-pics|generate>\n" +
        "  generate [--min-reviews N] [--top-weekly N] [--config path/to/generate_conf.yaml]",
    );
    process.exit(1);
}
