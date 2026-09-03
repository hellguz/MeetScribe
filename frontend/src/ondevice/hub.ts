/**
 * Model file resolution and download for the Parakeet worker.
 *
 * parakeet.js's own hub helper assembles each file in memory and then writes
 * the whole blob to IndexedDB before ONNX Runtime gets to see it — for a
 * 1.2 GB encoder that is several GB of transient memory and a long, silent
 * pause. Here each file streams straight into the Cache API (disk-backed),
 * and ORT is handed a blob URL backed by that cache entry.
 *
 * Files can be self-hosted: point VITE_PARAKEET_MODEL_BASE at a directory
 * holding the same file names as the Hugging Face repo.
 */
import type { ParakeetPlan } from './capabilities'

export const HF_REPO = 'ysdede/parakeet-tdt-0.6b-v3-onnx'
const CACHE_NAME = 'meetscribe-parakeet-v1'
/** Branches to try, in order; the parakeet.js demo pins the second for fp16. */
const REVISIONS = ['main', 'feat/fp16-canonical-v3']

export interface ResolvedFiles {
	base: string
	encoder: string
	encoderData: string | null
	decoder: string
	tokenizer: string
	filenames: { encoder: string; decoder: string }
}

export type ProgressFn = (file: string, loaded: number, total: number) => void

const hfBase = (revision: string) => `https://huggingface.co/${HF_REPO}/resolve/${revision}/`

/**
 * Does `url` exist? true / false, or null when the server could not be asked
 * (a CORS-blocked HEAD, an offline CDN) — the caller then tries optimistically.
 */
async function probe(url: string): Promise<boolean | null> {
	try {
		const res = await fetch(url, { method: 'HEAD' })
		if (res.ok) return true
		if (res.status === 404 || res.status === 403) return false
	} catch {
		/* fall through to a tiny ranged GET */
	}
	try {
		const res = await fetch(url, { headers: { Range: 'bytes=0-0' } })
		if (res.ok || res.status === 206) {
			res.body?.cancel().catch(() => {})
			return true
		}
		if (res.status === 404 || res.status === 403) return false
	} catch {
		/* unreachable */
	}
	return null
}

/** Find a base URL that has the files this plan needs. */
export async function resolveModelFiles(plan: ParakeetPlan, customBase?: string): Promise<ResolvedFiles> {
	const encoderName = plan === 'gpu-fp16' ? 'encoder-model.fp16.onnx' : 'encoder-model.int8.onnx'
	const decoderName = 'decoder_joint-model.int8.onnx'
	const bases = customBase ? [customBase.endsWith('/') ? customBase : `${customBase}/`] : REVISIONS.map(hfBase)

	const build = async (base: string): Promise<ResolvedFiles> => ({
		base,
		encoder: base + encoderName,
		encoderData: (await probe(`${base + encoderName}.data`)) === true ? `${base + encoderName}.data` : null,
		decoder: base + decoderName,
		tokenizer: base + 'vocab.txt',
		filenames: { encoder: encoderName, decoder: decoderName },
	})

	let unprobed: string | null = null
	for (const base of bases) {
		const found = await probe(base + encoderName)
		if (found === true) return build(base)
		if (found === null && unprobed === null) unprobed = base
	}
	if (unprobed) {
		console.warn(`[hub] Could not check ${unprobed}${encoderName}; trying it anyway.`)
		return build(unprobed)
	}
	throw new Error(`${encoderName} not found in ${customBase ?? HF_REPO} (checked ${bases.length} location${bases.length === 1 ? '' : 's'})`)
}

async function openCache(): Promise<Cache | null> {
	try {
		return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null
	} catch {
		return null
	}
}

/**
 * Fetch `url` (streaming, with progress) into the Cache API and return a blob
 * URL for it. A cached copy is used without touching the network. If the
 * cache is unavailable or refuses the file (quota, private mode), the file is
 * fetched again into memory instead.
 */
export async function downloadToObjectUrl(url: string, onProgress: ProgressFn, useCache = true): Promise<{ objectUrl: string; bytes: number; cached: boolean }> {
	const file = url.split('/').pop() ?? url
	const cache = useCache ? await openCache() : null

	if (cache) {
		const hit = await cache.match(url)
		if (hit) {
			const blob = await hit.blob()
			onProgress(file, blob.size, blob.size)
			return { objectUrl: URL.createObjectURL(blob), bytes: blob.size, cached: true }
		}
	}

	const res = await fetch(url)
	if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status}`)
	const total = Number(res.headers.get('content-length') || 0)
	const reader = res.body.getReader()
	let loaded = 0

	if (cache) {
		try {
			const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
			const putPromise = cache.put(url, new Response(readable, { headers: { 'Content-Type': 'application/octet-stream', ...(total ? { 'Content-Length': String(total) } : {}) } }))
			const writer = writable.getWriter()
			const pump = (async () => {
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					loaded += value.length
					await writer.write(value)
					onProgress(file, loaded, total || loaded)
				}
				await writer.close()
			})()
			await Promise.all([pump, putPromise])
			const stored = await cache.match(url)
			if (!stored) throw new Error('cache entry vanished')
			const blob = await stored.blob()
			return { objectUrl: URL.createObjectURL(blob), bytes: blob.size, cached: false }
		} catch (err) {
			console.warn(`[hub] Cache API could not store ${file}; downloading into memory instead.`, err)
			reader.cancel().catch(() => {})
			await cache.delete(url).catch(() => {})
			return downloadToObjectUrl(url, onProgress, false)
		}
	}

	const chunks: BlobPart[] = []
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		loaded += value.length
		chunks.push(value.slice().buffer as ArrayBuffer)
		onProgress(file, loaded, total || loaded)
	}
	const blob = new Blob(chunks, { type: 'application/octet-stream' })
	return { objectUrl: URL.createObjectURL(blob), bytes: blob.size, cached: false }
}
