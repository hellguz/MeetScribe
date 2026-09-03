/**
 * What this device can realistically run. Decides between the two Parakeet
 * plans and produces the warnings shown next to the toggle:
 *
 *   gpu-fp16 — encoder on WebGPU in fp16 (~1.2 GB download), decoder on WASM.
 *   cpu-int8 — everything on WASM with an int8 encoder (~0.6 GB download).
 *
 * Nothing here is fatal: the user can always try, and a failed model load
 * hands the meeting back to the server (see useOnDevice).
 */

export type ParakeetPlan = 'gpu-fp16' | 'cpu-int8'
export type PlanChoice = 'auto' | ParakeetPlan

export interface DeviceCapabilities {
	webgpu: boolean
	fp16: boolean
	crossOriginIsolated: boolean
	cores: number
	/** Chrome's navigator.deviceMemory, capped by the browser at 8. null elsewhere. */
	memoryGb: number | null
	isIOS: boolean
	isMobile: boolean
	recommended: ParakeetPlan
	warnings: string[]
}

export const PLAN_DOWNLOAD_BYTES: Record<ParakeetPlan, number> = {
	// encoder fp16 ≈ 1.2 GB + decoder int8 + tokenizer
	'gpu-fp16': 1.25e9,
	// encoder int8 ≈ 0.62 GB + decoder int8 + tokenizer
	'cpu-int8': 0.65e9,
}

export const PLAN_LABELS: Record<ParakeetPlan, string> = {
	'gpu-fp16': 'GPU · fp16 · ~1.2 GB',
	'cpu-int8': 'CPU · int8 · ~0.6 GB',
}

const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function detectCapabilities(): Promise<DeviceCapabilities> {
	let webgpu = false
	let fp16 = false
	const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
	if (gpu) {
		try {
			const adapter = await gpu.requestAdapter()
			if (adapter) {
				webgpu = true
				fp16 = adapter.features.has('shader-f16')
			}
		} catch {
			webgpu = false
		}
	}
	const crossOriginIsolated = typeof SharedArrayBuffer !== 'undefined' && (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
	const cores = navigator.hardwareConcurrency || 2
	const memoryGb = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null
	const isIOS = isIOSDevice()
	const isMobile = isIOS || /Android|Mobile/i.test(navigator.userAgent)

	const warnings: string[] = []
	if (isIOS) {
		warnings.push('iPhone/iPad: Safari gives a tab far less memory than the ~1.5 GB Parakeet needs. Expect this to fail or crash the tab; the server will take over if it does.')
	} else if (isMobile) {
		warnings.push('Phone detected: needs ~1.5 GB free RAM and will be slow. Keep the screen on — a backgrounded tab stops processing.')
	}
	if (!webgpu) {
		warnings.push('No WebGPU in this browser: Parakeet will run on the CPU (WASM), roughly 3–5× slower than on a GPU.')
	} else if (!fp16) {
		warnings.push('Your GPU has no fp16 support; using the CPU int8 model instead.')
	}
	if (!crossOriginIsolated) {
		warnings.push('Page is not cross-origin isolated (missing COOP/COEP headers): WASM runs single-threaded, so CPU work is slower.')
	}
	if (memoryGb !== null && memoryGb < 4) {
		warnings.push(`Only ~${memoryGb} GB RAM reported; the model may not fit.`)
	}

	const recommended: ParakeetPlan = webgpu && fp16 && !isIOS ? 'gpu-fp16' : 'cpu-int8'
	return { webgpu, fp16, crossOriginIsolated, cores, memoryGb, isIOS, isMobile, recommended, warnings }
}

export function resolvePlan(choice: PlanChoice, caps: DeviceCapabilities | null): ParakeetPlan {
	if (choice !== 'auto') return choice
	return caps?.recommended ?? 'cpu-int8'
}
