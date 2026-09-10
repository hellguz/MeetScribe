/**
 * What is already on this disk, and how to get rid of it.
 *
 * Local mode's whole cost is a one-time download of a few gigabytes, and
 * until now the panel could only quote the price — never say how much of it
 * had already been paid, and never offer to hand it back. Someone who wants
 * the space returned had to clear all site data, which also deletes their
 * meetings.
 *
 * Both models live in Cache API buckets of their own, keyed so that emptying
 * one never takes the other with it (see `hub.ts` and the summariser
 * worker's `env.cacheKey`). The diarization models are not in either: they
 * come from our own backend and ride the browser's normal HTTP cache, which
 * is why they are reported as a per-run cost rather than as a download.
 */
import { CACHE_NAME as SPEECH_CACHE } from './hub'

/** Must match `env.cacheKey` in `summary/summarizer.worker.ts`. */
export const SUMMARY_CACHE = 'meetscribe-summary-cache'

export const MODEL_CACHES = [SPEECH_CACHE, SUMMARY_CACHE] as const

export interface CachedModels {
	/** Bytes of the speech model on disk. */
	speech: number
	/** Bytes of the summary model on disk. */
	summary: number
	total: number
}

/**
 * Size of one bucket, from the stored responses' own Content-Length.
 *
 * Reading each blob would be exact and would also mean pulling three
 * gigabytes off disk to render a panel, so the header is trusted. Both
 * writers set it (`downloadToObjectUrl` copies it from the response;
 * transformers.js stores whole responses), and an entry without one is
 * counted as nothing rather than guessed at.
 */
async function bucketBytes(name: string): Promise<number> {
	try {
		if (typeof caches === 'undefined') return 0
		if (!(await caches.has(name))) return 0
		const cache = await caches.open(name)
		const requests = await cache.keys()
		const sizes = await Promise.all(
			requests.map(async (request) => {
				const hit = await cache.match(request)
				return Number(hit?.headers.get('content-length') ?? 0) || 0
			}),
		)
		return sizes.reduce((total, size) => total + size, 0)
	} catch {
		// No Cache API at all (a private window, or a browser that walls it
		// off): nothing is stored, which is the honest answer anyway.
		return 0
	}
}

export async function measureCachedModels(): Promise<CachedModels> {
	const [speech, summary] = await Promise.all([bucketBytes(SPEECH_CACHE), bucketBytes(SUMMARY_CACHE)])
	return { speech, summary, total: speech + summary }
}

/**
 * Delete both model buckets.
 *
 * Meetings are untouched: they live in IndexedDB (`local/store.ts`), which
 * this never opens. Resolves to the number of buckets actually removed.
 */
export async function clearModelCaches(): Promise<number> {
	if (typeof caches === 'undefined') return 0
	const results = await Promise.all(MODEL_CACHES.map((name) => caches.delete(name).catch(() => false)))
	return results.filter(Boolean).length
}
