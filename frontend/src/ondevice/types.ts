/** One recognised word with its position in the audio, as parakeet.js reports it. */
export interface TranscribeWord {
	text: string
	start_time: number
	end_time: number
	confidence?: number
}
