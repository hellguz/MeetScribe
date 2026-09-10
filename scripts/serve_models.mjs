#!/usr/bin/env node
/**
 * scripts/serve_models.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Serves a directory of Parakeet model files to the frontend, so
 * VITE_PARAKEET_MODEL_BASE can point at a locally built model (see
 * scripts/quantize_parakeet_encoder.py) instead of Hugging Face.
 *
 *   node scripts/serve_models.mjs ./data/parakeet-q8
 *   VITE_PARAKEET_MODEL_BASE=http://localhost:8787/ pnpm -C frontend dev
 *
 * Three headers matter and a plain static server gets them wrong:
 *
 *   Access-Control-Allow-Origin  the app is cross-origin isolated
 *     (Cross-Origin-Embedder-Policy: require-corp), so a cross-origin
 *     subresource has to arrive as a CORS response or the browser drops it.
 *   Cross-Origin-Resource-Policy the belt to that braces, for anything the
 *     browser decides to fetch in no-cors mode.
 *   Accept-Ranges / 206          frontend/src/ondevice/hub.ts probes for the
 *     optional `.onnx.data` sidecar with a HEAD, falling back to a one-byte
 *     ranged GET.
 *
 * Nothing here is used in production; the Docker image serves the frontend
 * through nginx and the models come from wherever the build pointed.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
	".onnx": "application/octet-stream",
	".data": "application/octet-stream",
	".txt": "text/plain; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

const root = resolve(process.argv[2] ?? "./data/parakeet-q8");
const port = Number(process.env.MODEL_PORT ?? 8787);

try {
	if (!statSync(root).isDirectory()) throw new Error("not a directory");
} catch {
	console.error(`[models] ${root} is not a directory.\nUsage: node scripts/serve_models.mjs <dir>`);
	process.exit(1);
}

/** Resolve a request path inside `root`, or null if it escapes. */
function safeJoin(urlPath) {
	const decoded = decodeURIComponent(urlPath.split("?")[0]);
	const target = resolve(join(root, normalize(decoded)));
	return target === root || target.startsWith(root + sep) ? target : null;
}

const server = createServer((req, res) => {
	const cors = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "Range, Content-Type",
		"Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
		"Cross-Origin-Resource-Policy": "cross-origin",
		"Accept-Ranges": "bytes",
	};

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors).end();
		return;
	}
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, cors).end();
		return;
	}

	const path = safeJoin(req.url ?? "/");
	let stat;
	try {
		if (!path) throw new Error("outside root");
		stat = statSync(path);
		if (stat.isDirectory()) throw new Error("directory");
	} catch {
		// hub.ts reads a 404 as "this optional file is absent", which is the
		// answer for the `.onnx.data` sidecar of a single-file model.
		console.log(`[models] ${req.method} ${req.url} -> 404`);
		res.writeHead(404, { ...cors, "Content-Type": "text/plain" }).end("not found\n");
		return;
	}

	const headers = { ...cors, "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" };
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");

	if (range) {
		const start = range[1] ? Number(range[1]) : 0;
		const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
		if (start > end || start >= stat.size) {
			res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` }).end();
			return;
		}
		console.log(`[models] ${req.method} ${req.url} -> 206 ${start}-${end}`);
		res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) });
		if (req.method === "HEAD") res.end();
		else createReadStream(path, { start, end }).pipe(res);
		return;
	}

	console.log(`[models] ${req.method} ${req.url} -> 200 ${(stat.size / 1e6).toFixed(0)} MB`);
	res.writeHead(200, { ...headers, "Content-Length": String(stat.size) });
	if (req.method === "HEAD") res.end();
	else createReadStream(path).pipe(res);
});

server.listen(port, () => {
	console.log(`[models] serving ${root} on http://localhost:${port}/`);
	console.log(`[models] build the frontend with VITE_PARAKEET_MODEL_BASE=http://localhost:${port}/`);
});
