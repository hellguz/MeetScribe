/**
 * End-to-end checks in a real browser, for the things that only show up there:
 * nothing loading unasked, the dial not going stale across a route change, and
 * the two storage panels being two different documents.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:5173'
// Any installed Chromium-family browser; playwright-core ships no binaries.
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MID = 'f1890bfb-56fd-4404-ad4a-84a46d9fdb87'
const OUT = process.env.OUT ?? '.'

const results = []
const check = async (name, fn) => {
	try {
		await fn()
		results.push(`PASS  ${name}`)
	} catch (e) {
		results.push(`FAIL  ${name}: ${e.message}`)
	}
}
const eq = (got, want, what) => {
	if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()
const requests = []
page.on('request', (r) => requests.push(r.url()))
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const seed = async (over = {}) => {
	await page.evaluate(
		async ([mid, over]) => {
			localStorage.setItem('meetscribe_local_mode', 'true')
			localStorage.setItem(
				'meetscribe_history',
				JSON.stringify([
					{ id: mid, title: 'Goldbeck Pilot Review', started_at: new Date().toISOString(), status: 'complete', storage: 'local', duration_seconds: 2520, ...over },
				]),
			)
			await new Promise((resolve, reject) => {
				const req = indexedDB.open('meetscribe-local', 1)
				req.onupgradeneeded = () => {
					const db = req.result
					if (!db.objectStoreNames.contains('meetings')) db.createObjectStore('meetings', { keyPath: 'id' })
				}
				req.onsuccess = () => {
					const tx = req.result.transaction('meetings', 'readwrite')
					tx.objectStore('meetings').put({
						id: mid,
						title: 'Goldbeck Pilot Review',
						started_at: new Date().toISOString(),
						transcript: 'Speaker 1: We reviewed the unit mix and the Revit export. '.repeat(30),
						segments: [],
						summary_markdown: '## Overview\n\nThe meeting covered the unit mix and the Revit export.',
						context: null,
						summary_length: 'narrative',
						summary_language_mode: 'auto',
						summary_custom_language: null,
						timezone: null,
						duration_seconds: 2520,
						word_count: 300,
						speaker_count: 1,
						client_stats: null,
						updated_at: new Date().toISOString(),
						unfinished: false,
						...over,
					})
					tx.oncomplete = () => resolve()
					tx.onerror = () => reject(tx.error)
				}
				req.onerror = () => reject(req.error)
			})
		},
		[MID, over],
	)
}

const dial = () =>
	page.evaluate(() => {
		const pill = [...document.querySelectorAll('span')].find((el) => el.querySelector('svg circle[stroke-dasharray]'))
		return pill ? pill.textContent.trim() : null
	})

const modelHits = () => requests.filter((u) => /huggingface|hf\.co|xethub|\.onnx|api\/models/.test(u))

await page.goto(`${BASE}/record`, { waitUntil: 'domcontentloaded' })
await seed()

// ── 1. the record page must fetch nothing at all ───────────────────────────
requests.length = 0
await page.goto(`${BASE}/record`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

await check('the record page downloads no models until asked', () => {
	if (modelHits().length !== 0) throw new Error(`${modelHits().length} model requests: ${modelHits().slice(0, 3).join(' , ')}`)
})
await check('the record page shows no dial when nothing was asked for', async () => eq(await dial(), null, 'dial'))
await check('local mode is still on, and says so', async () => {
	const pressed = await page.evaluate(() => {
		const group = document.querySelector('[aria-label="Where new meetings go"]')
		// The caution marker depends on the machine's WebGPU support, which is
		// not what this case is about.
		return [...group.querySelectorAll('button')].map((b) => `${b.textContent.trim().replace(/⚠/g, '')}:${b.getAttribute('aria-pressed')}`)
	})
	eq(pressed, ['On device:true', 'Cloud:false'], 'mode switch')
})

// ── 2. the dial must not go stale across a client-side route change ───────
await check('a route change leaves no stale dial behind', async () => {
	await page.click('text=Goldbeck Pilot Review')
	await page.waitForURL(/\/summary\//, { timeout: 10_000 })
	await page.waitForTimeout(2000)
	eq(await dial(), null, 'dial after navigating')
})

await check('the finished summary is on screen, with nothing offering to redo it', async () => {
	const text = await page.evaluate(() => document.body.innerText)
	if (!text.includes('unit mix and the Revit export')) throw new Error('summary missing')
	if (text.includes('Generate summary')) throw new Error('"Generate summary" offered for a finished meeting')
	if (text.includes('Writing the summary')) throw new Error('claims to be writing')
})

// ── 3. the padlock and the share mark open different documents ────────────
const openPanel = async (which) => {
	await page.evaluate((which) => {
		const group = document.querySelector('[aria-label="Whether this meeting is shared"]')
		const buttons = [...group.querySelectorAll('button')]
		buttons[which === 'lock' ? 0 : 1].click()
	}, which)
	await page.waitForTimeout(350)
	return page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? null)
}

await check('the padlock explains what happens and where it is kept', async () => {
	const text = await openPanel('lock')
	if (!text) throw new Error('no panel opened')
	if (!/On this device only/.test(text)) throw new Error(`wrong heading:\n${text}`)
	if (!/stored in this browser/i.test(text)) throw new Error(`does not say where it is kept:\n${text}`)
	if (/1 hour|1 week|Create link/.test(text)) throw new Error(`it is still the share panel:\n${text}`)
})

await check('the share mark opens the sharing panel instead', async () => {
	await page.keyboard.press('Escape')
	await page.waitForTimeout(200)
	const text = await openPanel('share')
	if (!text) throw new Error('no panel opened')
	if (!/Share this meeting/.test(text)) throw new Error(`wrong heading:\n${text}`)
	if (!/1 hour[\s\S]*Never/.test(text)) throw new Error(`no durations:\n${text}`)
	if (/Stop sharing/.test(text)) throw new Error('"Stop sharing" is still here')
	if (/localhost:5199\/summary/.test(text)) throw new Error(`the raw URL is still printed:\n${text}`)
})

await check('a meeting nobody can reach offers no Copy link', async () => {
	const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
	if (/Copy link/.test(text)) throw new Error('offers to copy a link that does not exist yet')
	if (!/Create link/.test(text)) throw new Error(`no way to create one:\n${text}`)
})

await page.screenshot({ path: `${OUT}/share-panel.png` })
await page.keyboard.press('Escape')

// ── 4. a shared meeting: amber, Copy link, amber Update link ──────────────
await check('a timed share turns the toggle amber, ground and all', async () => {
	const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
	await seed({ published: true, shared_until: soon })
	await page.goto(`${BASE}/summary/${MID}`, { waitUntil: 'domcontentloaded' })
	await page.waitForTimeout(1500)
	const seg = await page.evaluate(() => {
		const group = document.querySelector('[aria-label="Whether this meeting is shared"]')
		const buttons = [...group.querySelectorAll('button')]
		const active = buttons.find((b) => b.getAttribute('aria-pressed') === 'true')
		const cs = getComputedStyle(active)
		return { index: buttons.indexOf(active), color: cs.color, background: cs.backgroundColor }
	})
	if (seg.index !== 1) throw new Error('the padlock is active for a shared meeting')
	if (!/245, 158, 11/.test(seg.color)) throw new Error(`glyph is not amber: ${seg.color}`)
	if (!/245, 158, 11/.test(seg.background)) throw new Error(`ground is not amber: ${seg.background}`)
})

await check('a shared meeting offers Copy link and an amber Update link', async () => {
	const text = await openPanel('share')
	if (!/Copy link/.test(text)) throw new Error(`no Copy link:\n${text}`)
	if (!/Update link/.test(text)) throw new Error(`no Update link:\n${text}`)
	const bg = await page.evaluate(() => {
		const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === 'Update link')
		return getComputedStyle(b).backgroundColor
	})
	if (!/245, 158, 11/.test(bg)) throw new Error(`Update link is not amber: ${bg}`)
})

await check('the padlock on a shared meeting offers to stop sharing', async () => {
	await page.keyboard.press('Escape')
	await page.waitForTimeout(200)
	const text = await openPanel('lock')
	if (!/Keep it on this device/.test(text)) throw new Error(`wrong heading:\n${text}`)
	if (!/loses access/.test(text)) throw new Error(`does not say who loses access:\n${text}`)
	if (!/Stop sharing/.test(text)) throw new Error(`no action:\n${text}`)
})

await page.screenshot({ path: `${OUT}/lock-panel.png` })

if (errors.length) results.push(`FAIL  no page errors: ${errors.slice(0, 3).join(' | ')}`)
else results.push('PASS  no uncaught page errors throughout')

console.log(results.join('\n'))
await browser.close()
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
