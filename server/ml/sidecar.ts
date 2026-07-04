// ML-Sidecar-Orchestrator: startet den Python-Sidecar als child_process, übergibt einen Job (JSON via stdin)
// und liest das Ergebnis (JSON via stdout). Mit Timeout, Cancel (AbortSignal) und Fehlerbehandlung — sowie
// PURE-TS-FALLBACK, falls der Sidecar fehlt/scheitert (Plan: Python im Default, TS als Sicherheitsnetz).
// Pure: keine DB-Seiteneffekte. Pfadauflösung deckt Dev, Tests (ENV-Override) und das gepackte Electron-App ab.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SidecarJob {
  kind: string;
  payload?: unknown;
}

export interface SidecarResult<T = unknown> {
  ok: boolean;
  kind?: string | null;
  result?: T;
  error?: string;
  meta?: { engine: string; python?: string; numpy?: string | null };
}

export interface SidecarPaths {
  python: string;
  engine: string;
  exists: boolean;
  packaged?: boolean; // gepackte Electron-Runtime → braucht compiler-freies Härten (pytensor)
}

/** Pfadauflösung: ENV-Override (Tests/Dev) → gepackt (process.resourcesPath/sidecar) → Dev (Quelle). */
export function sidecarPaths(): SidecarPaths {
  const isWin = process.platform === "win32";

  // 1) explizite Overrides — für Tests und lokale Entwicklung
  const envPy = process.env.RUNLOG_SIDECAR_PYTHON;
  const envDir = process.env.RUNLOG_SIDECAR_DIR;
  if (envPy || envDir) {
    const dir = envDir || join(__dirname, "..", "ml-sidecar");
    const python = envPy || (isWin ? "python.exe" : "python3");
    const engine = join(dir, "engine.py");
    return { python, engine, exists: existsSync(engine) };
  }

  // 2) gepacktes Electron-App: extraResources landen in process.resourcesPath/sidecar
  const res = (process as { resourcesPath?: string }).resourcesPath;
  if (res) {
    const dir = join(res, "sidecar");
    const python = join(dir, "runtime", isWin ? "python.exe" : join("bin", "python3"));
    const engine = join(dir, "engine.py");
    if (existsSync(engine)) return { python, engine, exists: existsSync(python), packaged: true };
  }

  // 3) Dev: Quelle relativ zu diesem Modul; lokales .venv bevorzugt, sonst System-python3
  const dir = join(__dirname, "..", "ml-sidecar");
  const venvPy = join(dir, ".venv", isWin ? join("Scripts", "python.exe") : join("bin", "python3"));
  const python = existsSync(venvPy) ? venvPy : isWin ? "python.exe" : "python3";
  const engine = join(dir, "engine.py");
  return { python, engine, exists: existsSync(engine) };
}

export interface RunOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Führt einen Job im Python-Sidecar aus. Wirft bei fehlendem Sidecar, Timeout, Cancel, Nonzero oder Parse-Fehler. */
export function runSidecar<T = unknown>(job: SidecarJob, opts: RunOpts = {}): Promise<SidecarResult<T>> {
  const { timeoutMs = 120_000, signal } = opts;
  const p = sidecarPaths();
  return new Promise<SidecarResult<T>>((resolve, reject) => {
    if (!p.exists) return reject(new Error("sidecar engine.py nicht gefunden"));
    if (signal?.aborted) return reject(new Error("abgebrochen"));

    // Gepackte Runtime läuft auf sauberen Endnutzer-Rechnern OHNE System-C-Compiler (gcc/clang/MSVC).
    // pytensor (via PyMC) auf den compiler-freien Pfad zwingen (cxx= → Python-Fallback statt C-Kompilat) und
    // einen sicher beschreibbaren Compile-Cache setzen. Externe ENV gewinnt (Dev/Power-User können übersteuern).
    const env = { ...process.env };
    if (p.packaged) {
      env.PYTENSOR_FLAGS = process.env.PYTENSOR_FLAGS || "cxx=";
      env.PYTENSOR_COMPILEDIR = process.env.PYTENSOR_COMPILEDIR || join(tmpdir(), "runlog-pytensor");
    }
    const child = spawn(p.python, [p.engine], { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    let err = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(() => reject(new Error(`sidecar timeout nach ${timeoutMs}ms`)));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      done(() => reject(new Error("abgebrochen")));
    };
    signal?.addEventListener("abort", onAbort);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => done(() => reject(e)));
    child.on("close", (code) => {
      done(() => {
        try {
          resolve(JSON.parse(out) as SidecarResult<T>);
        } catch {
          reject(new Error(`sidecar lieferte kein JSON (exit ${code}): ${(err || out).slice(0, 500)}`));
        }
      });
    });

    try {
      child.stdin.write(JSON.stringify(job));
      child.stdin.end();
    } catch (e) {
      done(() => reject(e as Error));
    }
  });
}

let _info: Promise<SidecarResult> | null = null;
/** Einmalige Verfügbarkeits-Probe (health-Job). Cacht das Ergebnis; `force` erzwingt Neu-Probe. */
export function sidecarInfo(force = false): Promise<SidecarResult> {
  if (!_info || force) {
    _info = runSidecar({ kind: "health" }, { timeoutMs: 8000 }).catch(
      (e) => ({ ok: false, error: String(e?.message || e), meta: { engine: "none" } }) as SidecarResult,
    );
  }
  return _info;
}

export async function sidecarAvailable(force = false): Promise<boolean> {
  return (await sidecarInfo(force)).ok === true;
}

/** Sidecar mit Pure-TS-Fallback: nutzt Python wenn verfügbar, sonst die TS-Funktion. Liefert die genutzte Engine mit. */
export async function runWithFallback<T>(
  job: SidecarJob,
  fallback: () => T | Promise<T>,
  opts: RunOpts = {},
): Promise<{ engine: "python" | "ts"; result: T }> {
  if (await sidecarAvailable()) {
    try {
      const r = await runSidecar<T>(job, opts);
      if (r.ok && r.result !== undefined) return { engine: "python", result: r.result };
    } catch {
      /* fällt auf TS zurück */
    }
  }
  return { engine: "ts", result: await fallback() };
}
