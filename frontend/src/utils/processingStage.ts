/**
 * Turns the backend's processing_stage / processing_total into a progress
 * label like "Step 2 of 3 · Identifying speakers".
 *
 * The pipeline differs by origin, which is why the backend sends the total:
 *   fresh recording  (2) — diarize, summarize        (already transcribed live)
 *   reprocessing old (3) — transcribe, diarize, summarize
 */
const LABELS: Record<string, string> = {
	transcribing: 'Re-transcribing audio',
	diarizing: 'Identifying speakers',
	summarizing: 'Writing summary',
}

// Longest pipeline first; a run's stages are the last `total` of these.
const PIPELINE = ['transcribing', 'diarizing', 'summarizing']

export interface StageProgress {
	label: string
	step: number | null
	total: number | null
}

export function describeStage(stage: string | null, total: number | null, fallback = 'Processing'): StageProgress {
	const name = stage ? LABELS[stage] : undefined
	if (!stage || !name) return { label: fallback, step: null, total: null }

	if (!total || total <= 0) return { label: name, step: null, total: null }

	// Take the tail of the pipeline matching this run's length, so a 2-step run
	// correctly reports diarizing as step 1 rather than step 2.
	const stages = PIPELINE.slice(Math.max(0, PIPELINE.length - total))
	const index = stages.indexOf(stage)
	if (index === -1) return { label: name, step: null, total: null }
	return { label: name, step: index + 1, total: stages.length }
}

/** "Step 2 of 3 · Identifying speakers", or just the label when unknown. */
export function stageText(stage: string | null, total: number | null, fallback = 'Processing'): string {
	const { label, step, total: n } = describeStage(stage, total, fallback)
	return step && n ? `Step ${step} of ${n} · ${label}` : `${label}…`
}
