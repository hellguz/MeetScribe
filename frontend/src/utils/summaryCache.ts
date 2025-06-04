// ./frontend/src/utils/summaryCache.ts
/**
 * Lightweight browser-side cache that stores finished summaries
 * (and optional transcripts) for up to 5 years.
 */

export interface CachedSummary {
  id: string;
  summary: string;
  transcript?: string | null;
  updatedAt: string; // ISO timestamp
}

const CACHE_KEY = "meetscribe_cached_summaries";
const FIVE_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 5;

/* ─── internal helpers ──────────────────────────────────────────────── */
function read(): CachedSummary[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(list: CachedSummary[]) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(list));
}

/* ─── public API ────────────────────────────────────────────────────── */
export function getCached(id: string): CachedSummary | null {
  const list = read();
  const now = Date.now();
  for (const item of list) {
    if (item.id === id) {
      // Prune any entry older than 5 years
      if (now - new Date(item.updatedAt).getTime() > FIVE_YEARS_MS) return null;
      return item;
    }
  }
  return null;
}

export function saveCached(data: CachedSummary) {
  const list = read().filter((i) => i.id !== data.id); // drop existing copy
  list.push(data);
  write(list);
}
