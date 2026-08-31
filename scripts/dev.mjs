#!/usr/bin/env node
/**
 * scripts/dev.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Bootstraps and runs the backend for local (non-Docker) development.
 *
 *   node scripts/dev.mjs setup     install Python + Node deps, run migrations
 *   node scripts/dev.mjs migrate   run database migrations only
 *   node scripts/dev.mjs backend   bootstrap (if needed) then uvicorn --reload
 *
 * Docker remains the production path; nothing here is used by the images.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(ROOT, "backend");
const VENV = join(BACKEND, ".venv");
const IS_WIN = process.platform === "win32";
const VENV_PYTHON = join(VENV, IS_WIN ? "Scripts" : "bin", IS_WIN ? "python.exe" : "python");
const REQUIREMENTS = join(BACKEND, "requirements.txt");
const STAMP = join(VENV, ".requirements.sha256");
const PORT = process.env.BACKEND_PORT ?? "8000";

function log(msg) {
	console.log(`\x1b[36m[dev]\x1b[0m ${msg}`);
}

function warn(msg) {
	console.warn(`\x1b[33m[dev]\x1b[0m ${msg}`);
}

/**
 * Run a command to completion; exit the process if it fails. Pass
 * `allowFailure` for best-effort steps (e.g. restoring pip into a venv that
 * may already have it) where a non-zero exit is not an error.
 */
function run(cmd, args, opts = {}) {
	const { allowFailure = false, ...spawnOpts } = opts;
	const result = spawnSync(cmd, args, { stdio: "inherit", ...spawnOpts });
	if (result.error) {
		if (allowFailure) return false;
		console.error(`\x1b[31m[dev]\x1b[0m failed to launch ${cmd}: ${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) {
		if (allowFailure) return false;
		console.error(`\x1b[31m[dev]\x1b[0m ${cmd} exited with code ${result.status}`);
		process.exit(result.status ?? 1);
	}
	return true;
}

/**
 * The Python version is declared once, in /.python-version, and the backend
 * image builds FROM that same version. Local dev uses it too, so a bug that
 * only shows up on one interpreter cannot hide until production.
 */
function requiredPythonVersion() {
	const declared = readFileSync(join(ROOT, ".python-version"), "utf8").trim();
	if (!/^\d+\.\d+$/.test(declared)) {
		console.error(`[31m[dev][0m .python-version must be "major.minor", got "${declared}".`);
		process.exit(1);
	}

	// Guard against the two declarations drifting apart.
	const dockerfile = readFileSync(join(BACKEND, "Dockerfile"), "utf8");
	const arg = dockerfile.match(/^ARG\s+PYTHON_VERSION=(\S+)/m);
	if (!arg) {
		console.error("[31m[dev][0m backend/Dockerfile has no ARG PYTHON_VERSION to check against.");
		process.exit(1);
	}
	if (arg[1] !== declared) {
		console.error(
			`[31m[dev][0m Version drift: .python-version says ${declared}, ` +
				`backend/Dockerfile says ${arg[1]}. Make them match.`,
		);
		process.exit(1);
	}

	return declared;
}

function probePythonVersion(cmd, args) {
	const probe = spawnSync(cmd, [...args, "-c", "import sys;print('%d.%d' % sys.version_info[:2])"], {
		encoding: "utf8",
	});
	if (probe.status !== 0 || !probe.stdout) return null;
	return probe.stdout.trim();
}

/** Find an interpreter matching .python-version exactly, to create the venv. */
function findBasePython(required) {
	const candidates = IS_WIN
		? [`py -${required}`, "python", "python3", "py -3"]
		: [`python${required}`, "python3", "python"];

	const rejected = [];
	for (const candidate of candidates) {
		const [cmd, ...args] = candidate.split(" ");
		const found = probePythonVersion(cmd, args);
		if (!found) continue;
		if (found !== required) {
			rejected.push(`${candidate} (${found})`);
			continue;
		}
		log(`Using ${candidate} (${found}) to create the virtualenv.`);
		return [cmd, args];
	}

	console.error(
		`[31m[dev][0m Python ${required} not found — it is the version this ` +
			"project builds and deploys with (see /.python-version).",
	);
	if (rejected.length) console.error(`[31m[dev][0m Wrong version: ${rejected.join(", ")}`);
	console.error(
		`[31m[dev][0m Install Python ${required}, or change /.python-version ` +
			"and backend/Dockerfile together to move both dev and production.",
	);
	process.exit(1);
}

/** Copy .env.sample -> .env on first run so the backend can boot. */
function ensureEnvFile() {
	const env = join(ROOT, ".env");
	if (existsSync(env)) return;
	copyFileSync(join(ROOT, ".env.sample"), env);
	warn(".env was missing — created it from .env.sample.");
	warn("Set ANTHROPIC_API_KEY and SECRET_KEY in .env before recording a meeting.");
}

/**
 * A venv is only trustworthy if its interpreter runs AND the packages the app
 * imports are actually importable. An interrupted install leaves a directory
 * tree with missing files, which a plain existsSync check happily accepts.
 */
const VENV_HEALTH_IMPORTS = "import sqlmodel, apscheduler.schedulers.background, fastapi";

function venvIsHealthy() {
	const probe = spawnSync(VENV_PYTHON, ["-c", VENV_HEALTH_IMPORTS], { encoding: "utf8" });
	return probe.status === 0;
}

/**
 * Create the venv and install requirements.txt when missing, changed, or
 * damaged. Also rebuilds if the interpreter no longer matches .python-version,
 * so bumping that file is all it takes to move local dev.
 */
function ensurePythonEnv() {
	const required = requiredPythonVersion();
	const wanted = createHash("sha256").update(readFileSync(REQUIREMENTS)).digest("hex");
	const stamped = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : "";

	// `distrust` means the existing venv must be replaced outright rather than
	// installed into — a damaged venv can have a gutted pip, which makes
	// `pip install` unable to repair anything.
	let distrust = null;
	if (!existsSync(VENV_PYTHON)) {
		distrust = existsSync(VENV) ? "no interpreter" : null;
	} else {
		// Retry once: a transient probe failure must not be read as "wrong
		// version", which would discard a perfectly good venv.
		const found = probePythonVersion(VENV_PYTHON, []) ?? probePythonVersion(VENV_PYTHON, []);
		if (found === null) {
			distrust = "its interpreter will not run";
		} else if (found !== required) {
			distrust = `it is Python ${found}, but ${required} is required`;
		} else if (!venvIsHealthy()) {
			// Checked independently of the stamp: damage can delete the stamp
			// too, and then a stamp comparison would silently miss it.
			distrust = "its installed packages are not importable";
		} else if (stamped === wanted) {
			return; // healthy and up to date
		}
	}

	if (distrust) {
		warn(`Rebuilding backend/.venv: ${distrust}.`);
		rmSync(VENV, { recursive: true, force: true });
	}

	if (!existsSync(VENV_PYTHON)) {
		log("Creating Python virtualenv at backend/.venv (first run, this takes a minute)...");
		const [cmd, args] = findBasePython(required);
		run(cmd, [...args, "-m", "venv", VENV]);
	}

	log("Installing Python dependencies from backend/requirements.txt...");
	run(VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);
	run(VENV_PYTHON, ["-m", "pip", "install", "-r", REQUIREMENTS]);

	// Stamp only once the install is proven good, so an interrupted run is
	// retried next time instead of being skipped forever.
	if (!venvIsHealthy()) {
		console.error(
			"[31m[dev][0m Dependencies installed but the app still cannot import them. " +
				"Delete backend/.venv and retry.",
		);
		process.exit(1);
	}
	writeFileSync(STAMP, wanted);
}

/** Install workspace Node deps if the frontend has never been installed. */
function ensureNodeModules() {
	if (existsSync(join(ROOT, "frontend", "node_modules"))) return;
	log("Installing Node dependencies...");
	// pnpm is a .cmd shim on Windows, so it needs a shell to resolve.
	run("pnpm", ["install"], { cwd: ROOT, shell: IS_WIN });
}

function migrate() {
	run(VENV_PYTHON, [join(BACKEND, "utils", "run_migrations.py")], { cwd: BACKEND });
}

/** ffmpeg is optional but transcription quality/compat depends on it. */
function checkFfmpeg() {
	const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
	if (probe.status !== 0) {
		warn("ffmpeg not found on PATH. Audio is sent unconverted; install ffmpeg for best results.");
	}
}

function backend() {
	log(`Starting FastAPI on http://localhost:${PORT} (docs at /docs)`);
	const child = spawn(
		VENV_PYTHON,
		["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", PORT, "--reload"],
		{ cwd: BACKEND, stdio: "inherit" },
	);
	// Let concurrently's signal handling drive shutdown; mirror the exit code.
	child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

const command = process.argv[2] ?? "backend";

switch (command) {
	case "setup":
		ensureEnvFile();
		ensureNodeModules();
		ensurePythonEnv();
		migrate();
		checkFfmpeg();
		log("Setup complete. Run `pnpm dev`.");
		break;
	case "migrate":
		// migrations import app.config, which reads the root .env.
		ensureEnvFile();
		ensurePythonEnv();
		migrate();
		break;
	case "backend":
		ensureEnvFile();
		ensurePythonEnv();
		migrate();
		checkFfmpeg();
		backend();
		break;
	default:
		console.error(`Unknown command: ${command}. Use setup | migrate | backend.`);
		process.exit(1);
}
