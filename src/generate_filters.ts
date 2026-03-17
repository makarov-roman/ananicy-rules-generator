export type FilterId = "remove-non-bin" | "remove-sh";

function basenameOf(bin: string): string {
  return bin.split(/[/\\]/).pop() ?? bin;
}

/** Lowercase extension including dot, e.g. ".exe", or "" */
function extensionOf(bin: string): string {
  const base = basenameOf(bin);
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "";
  return base.slice(dot).toLowerCase();
}

// --- Filters (each self-contained): return true to keep the bin, false to drop ---

/** EA / Origin style pseudo-URL in Steam launch executable, and non-exec documents */
export function filterRemoveNonBin(bin: string): boolean {
  if (/^\d+\?platform=steam&theme=/i.test(bin)) return false;
  const ext = extensionOf(bin);
  if (ext === ".pdf" || ext === ".html" || ext === ".htm") return false;
  return true;
}

/** Shell / installer-style launch entries */
export function filterRemoveSh(bin: string): boolean {
  const ext = extensionOf(bin);
  if (ext === ".sh" || ext === ".bat" || ext === ".run") return false;
  return true;
}

export const FILTER_REGISTRY: Record<FilterId, (bin: string) => boolean> = {
  "remove-non-bin": filterRemoveNonBin,
  "remove-sh": filterRemoveSh,
};

const KNOWN_FILTER_IDS = new Set<string>(Object.keys(FILTER_REGISTRY));

export function isKnownFilterId(id: string): id is FilterId {
  return KNOWN_FILTER_IDS.has(id);
}

/** Whether a launch basename should be emitted as an ananicy rule */
export function binPassesFilters(bin: string, filters: Set<FilterId>): boolean {
  for (const id of filters) {
    const fn = FILTER_REGISTRY[id];
    if (!fn(bin)) return false;
  }
  return true;
}
