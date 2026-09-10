/**
 * Agglomerative clustering with complete linkage over cosine distance, cut at a
 * distance threshold — the same procedure as sherpa-onnx's FastClustering
 * (which wraps fastcluster's hclust_fast + cutree_cdist).
 *
 * Implemented with the nearest-neighbour-chain algorithm, so it is O(n²) in
 * time and memory rather than the O(n³) of the textbook version. An hour of
 * audio yields a couple of thousand embeddings, which is comfortably fast.
 */

/** Labels every row of `embeddings` (row-major, `dim` wide) with a cluster id. */
export function clusterEmbeddings(embeddings: Float32Array, rows: number, dim: number, threshold: number): Int32Array {
	if (rows <= 0) return new Int32Array(0)
	if (rows === 1) return new Int32Array([0])

	// L2-normalise rows so the dot product is the cosine similarity.
	const unit = new Float32Array(embeddings)
	for (let i = 0; i < rows; i++) {
		let norm = 0
		for (let d = 0; d < dim; d++) norm += unit[i * dim + d] * unit[i * dim + d]
		norm = Math.sqrt(norm) || 1
		for (let d = 0; d < dim; d++) unit[i * dim + d] /= norm
	}

	// Full distance matrix, d = max(0, 1 - cos).
	const dist = new Float64Array(rows * rows)
	for (let i = 0; i < rows; i++) {
		for (let j = i + 1; j < rows; j++) {
			let dot = 0
			for (let d = 0; d < dim; d++) dot += unit[i * dim + d] * unit[j * dim + d]
			const v = Math.max(0, 1 - dot)
			dist[i * rows + j] = v
			dist[j * rows + i] = v
		}
	}

	// Union-find over merges below the threshold. Complete linkage is
	// monotone, so cutting by merge height is a valid dendrogram cut.
	const parent = new Int32Array(rows)
	for (let i = 0; i < rows; i++) parent[i] = i
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}

	const active = new Uint8Array(rows).fill(1)
	let remaining = rows
	const chain: number[] = []

	while (remaining > 1) {
		if (chain.length === 0) {
			let seed = 0
			while (!active[seed]) seed++
			chain.push(seed)
		}
		let a = chain[chain.length - 1]
		// Walk to a reciprocal nearest-neighbour pair.
		for (;;) {
			let best = -1
			let bestDist = Infinity
			const prev = chain.length >= 2 ? chain[chain.length - 2] : -1
			for (let j = 0; j < rows; j++) {
				if (j === a || !active[j]) continue
				const d = dist[a * rows + j]
				// Prefer the previous chain element on ties so the chain terminates.
				if (d < bestDist || (d === bestDist && j === prev)) {
					bestDist = d
					best = j
				}
			}
			if (best === prev) {
				chain.pop()
				chain.pop()
				// Merge `a` and `best` at height bestDist (complete linkage:
				// new distance to any k is the max of the two old ones).
				if (bestDist < threshold) parent[find(best)] = find(a)
				for (let k = 0; k < rows; k++) {
					if (!active[k] || k === a || k === best) continue
					const merged = Math.max(dist[a * rows + k], dist[best * rows + k])
					dist[a * rows + k] = merged
					dist[k * rows + a] = merged
				}
				active[best] = 0
				remaining--
				break
			}
			chain.push(best)
			a = best
		}
	}

	// Compact roots into 0..K-1 in order of first appearance.
	const labels = new Int32Array(rows)
	const ids = new Map<number, number>()
	for (let i = 0; i < rows; i++) {
		const root = find(i)
		let id = ids.get(root)
		if (id === undefined) {
			id = ids.size
			ids.set(root, id)
		}
		labels[i] = id
	}
	return labels
}
