/**
 * Post-processing that lives in backend/app/diarization.py on the server,
 * ported so the on-device path produces the identical labelled transcript:
 * fold noise clusters into real speakers, renumber by first appearance, and
 * attach a "Speaker N:" label to each transcript segment.
 */

export interface SpeakerTurn {
	start: number
	end: number
	speaker: number
}

export interface TranscriptSegment {
	start: number
	end: number
	text: string
}

export interface TranscriptChunk {
	index: number
	text: string
	segments: TranscriptSegment[]
	/** Absolute start of the chunk within the whole recording, seconds. */
	offset: number | null
}

/**
 * Fold away clusters holding less than `minShare` of the speech into their
 * nearest real speaker. Same rule and reasoning as `_prune_minor_speakers`.
 */
export function pruneMinorSpeakers(turns: SpeakerTurn[], minShare: number): SpeakerTurn[] {
	if (turns.length === 0) return turns
	const talk = new Map<number, number>()
	for (const t of turns) talk.set(t.speaker, (talk.get(t.speaker) ?? 0) + (t.end - t.start))
	let total = 0
	for (const s of talk.values()) total += s
	total = total || 1

	const major = new Set<number>()
	for (const [speaker, seconds] of talk) if (seconds / total >= minShare) major.add(speaker)
	if (major.size === 0 || major.size === talk.size) return turns

	const majorTurns = turns.filter((t) => major.has(t.speaker))
	if (majorTurns.length === 0) return turns

	const nearestMajor = (turn: SpeakerTurn): number => {
		let best = turn.speaker
		let bestDistance = Infinity
		for (const other of majorTurns) {
			if (other.end >= turn.start && other.start <= turn.end) return other.speaker
			const distance = Math.min(Math.abs(turn.start - other.end), Math.abs(other.start - turn.end))
			if (distance < bestDistance) {
				best = other.speaker
				bestDistance = distance
			}
		}
		return best
	}

	return turns.map((t) => (major.has(t.speaker) ? t : { start: t.start, end: t.end, speaker: nearestMajor(t) }))
}

/** Renumber so "Speaker 1" is whoever spoke first. Returns [turns, count]. */
export function renumberByFirstAppearance(turns: SpeakerTurn[]): [SpeakerTurn[], number] {
	const order = new Map<number, number>()
	const out: SpeakerTurn[] = []
	for (const t of turns) {
		let id = order.get(t.speaker)
		if (id === undefined) {
			id = order.size + 1
			order.set(t.speaker, id)
		}
		out.push({ start: t.start, end: t.end, speaker: id })
	}
	return [out, order.size]
}

/** The speaker whose turn overlaps [start, end] most, or null. Turns must be sorted by start. */
function speakerFor(start: number, end: number, turns: SpeakerTurn[]): number | null {
	let bestSpeaker: number | null = null
	let bestOverlap = 0
	for (const turn of turns) {
		if (turn.end <= start) continue
		if (turn.start >= end) break
		const overlap = Math.min(end, turn.end) - Math.max(start, turn.start)
		if (overlap > bestOverlap) {
			bestSpeaker = turn.speaker
			bestOverlap = overlap
		}
	}
	return bestSpeaker
}

/** Build the "Speaker N: …" transcript. Mirrors `label_transcript` exactly. */
export function labelTranscript(chunks: TranscriptChunk[], turns: SpeakerTurn[]): string {
	const blocks: [number | null, string[]][] = []
	const append = (speaker: number | null, text: string) => {
		text = text.trim()
		if (!text) return
		const last = blocks[blocks.length - 1]
		if (last && last[0] === speaker) last[1].push(text)
		else blocks.push([speaker, [text]])
	}

	for (const chunk of chunks) {
		if (chunk.offset === null || chunk.segments.length === 0) {
			if (chunk.text) append(blocks.length ? blocks[blocks.length - 1][0] : null, chunk.text)
			continue
		}
		for (const seg of chunk.segments) {
			const text = seg.text.trim()
			if (!text) continue
			const start = chunk.offset + seg.start
			const end = chunk.offset + seg.end
			let speaker = speakerFor(start, end, turns)
			if (speaker === null) speaker = blocks.length ? blocks[blocks.length - 1][0] : null
			append(speaker, text)
		}
	}

	// Speech before the first detected turn belongs to whoever spoke first.
	const firstKnown = blocks.find((b) => b[0] !== null)?.[0] ?? null
	if (firstKnown !== null) {
		for (const block of blocks) {
			if (block[0] !== null) break
			block[0] = firstKnown
		}
	}

	const coalesced: [number | null, string[]][] = []
	for (const [speaker, parts] of blocks) {
		const last = coalesced[coalesced.length - 1]
		if (last && last[0] === speaker) last[1].push(...parts)
		else coalesced.push([speaker, [...parts]])
	}

	return coalesced
		.map(([speaker, parts]) => `${speaker !== null ? `Speaker ${speaker}` : 'Unknown speaker'}: ${parts.join(' ')}`)
		.join('\n\n')
}
