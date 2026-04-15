import assert from "node:assert/strict";
import test from "node:test";
import {
  appIdFromVendorHashLine,
  applyVendorRulesLines,
  type VendorRuleBins,
} from "./vendor_upstream";

function wineMap(): Map<number, VendorRuleBins> {
  return new Map();
}

test("appIdFromVendorHashLine: # appid: title (hash header)", () => {
  assert.equal(
    appIdFromVendorHashLine("# 273110: Counter-Strike Nexon: Studio"),
    273110,
  );
});

test("appIdFromVendorHashLine: long appid is not parsed as shorter id inside it", () => {
  assert.equal(appIdFromVendorHashLine("# 9273110: Other"), 9273110);
  assert.equal(appIdFromVendorHashLine("# 273110: Short"), 273110);
});

test("appIdFromVendorHashLine: Steam store URL /app/<id>/", () => {
  assert.equal(
    appIdFromVendorHashLine(
      "# PoE https://store.steampowered.com/app/238960/Path_of_Exile/",
    ),
    238960,
  );
});

test("applyVendorRulesLines: ## Wine / ## Native do not drop the appid block", () => {
  const map = wineMap();
  const text = `# 730: Team Fortress 2
## Wine
{ "name": "hl2.exe", "type": "Game" }
`;
  applyVendorRulesLines(text, "wine", map);
  assert.ok(map.has(730));
  assert.ok(map.get(730)!.wine.has("hl2.exe"));
});

test("applyVendorRulesLines: two # store URLs then one Game JSON (common.rules)", () => {
  const map = wineMap();
  const text = `# Path of Exile https://store.steampowered.com/app/238960/Path/
# Path of Exile 2 https://store.steampowered.com/app/2694490/Path2/
{ "name": "PathOfExile.exe", "type": "Game" }
`;
  applyVendorRulesLines(text, "wine", map);
  assert.ok(map.get(238960)!.wine.has("PathOfExile.exe"));
  assert.ok(map.get(2694490)!.wine.has("PathOfExile.exe"));
});

test("applyVendorRulesLines: BG_CPUIO line then Game (Empyrion 383120)", () => {
  const map = wineMap();
  const text = `# Empyrion https://store.steampowered.com/app/383120/Empyrion/
{ "name": "EmpyrionLauncher.exe", "type": "BG_CPUIO" }
{ "name": "Empyrion.exe", "type": "Game" }
`;
  applyVendorRulesLines(text, "wine", map);
  assert.ok(map.has(383120));
  assert.ok(map.get(383120)!.wine.has("Empyrion.exe"));
  assert.equal(map.get(383120)!.wine.has("EmpyrionLauncher.exe"), false);
});

test('applyVendorRulesLines: Game line without space before } (NGU IDLE 1147690)', () => {
  const map = wineMap();
  const text = `# NGU IDLE https://store.steampowered.com/app/1147690/NGU_IDLE/
{ "name": "NGUIdle.exe", "type": "Game"}
`;
  applyVendorRulesLines(text, "wine", map);
  assert.ok(map.get(1147690)!.wine.has("NGUIdle.exe"));
});

test('applyVendorRulesLines: accepts "Game" } with space before closing brace', () => {
  const map = wineMap();
  const text = `# X https://store.steampowered.com/app/1/x/
{ "name": "a.exe", "type": "Game" }
`;
  applyVendorRulesLines(text, "wine", map);
  assert.ok(map.get(1)!.wine.has("a.exe"));
});
