# ananicy-rules-generator

Generates ananicy process priority rules for Steam games using SteamSpy and Steam PICS data.

```sh
# via docker
docker build -t ananicy-rules .

# Fetch SteamSpy data (persists DB via volume)
docker run -v ./data:/app/data ananicy-rules fetch-spy

# Fetch executables
docker run -v ./data:/app/data ananicy-rules fetch-pics

# Generate rules
docker run -v ./data:/app/data ananicy-rules generate --min-reviews 1000 --top-weekly 1000

# directly
npm install
npx tsx src/index.ts fetch-spy          # scrape SteamSpy (slow, ~1 req/min)
npx tsx src/index.ts fetch-spy 5        # resume from page 5
npx tsx src/index.ts fetch-pics         # fetch executables via Steam PICS
npx tsx src/index.ts generate           # output rules to stdout
npx tsx src/index.ts generate --min-reviews 1000 --top-weekly 500
```
