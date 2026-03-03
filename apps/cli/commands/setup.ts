/**
 * MirrorAI CLI — Phase 2 Setup Command
 * Handles deferred installation steps after quick install.
 *
 * Usage:
 *   mirrorai setup models    # Pull Ollama models
 *   mirrorai setup vectordb  # Start ChromaDB
 *   mirrorai setup full      # All of the above
 */

import { Command } from "commander";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "yaml";

const MIRRORAI_HOME = path.join(os.homedir(), ".mirrorai");
const LOG_FILE = path.join(MIRRORAI_HOME, "logs", "setup.log");
const CONFIG_PATH = path.join(MIRRORAI_HOME, "mirrorai.config.yaml");
const STATE_PATH = path.join(MIRRORAI_HOME, "state.json");
const OLLAMA_PORT = 11434;
const CHROMADB_PORT = 8000;

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  } catch {}
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
  try { fs.appendFileSync(LOG_FILE, `  ✓ ${msg}\n`); } catch {}
}

function warn(msg: string): void {
  console.log(`  ⚠ ${msg}`);
  try { fs.appendFileSync(LOG_FILE, `  ⚠ ${msg}\n`); } catch {}
}

function err(msg: string): void {
  console.error(`  ✗ ${msg}`);
  try { fs.appendFileSync(LOG_FILE, `  ✗ ${msg}\n`); } catch {}
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 300000 }).trim();
  } catch (e: unknown) {
    const error = e as { stderr?: string };
    return error.stderr ?? "";
  }
}

function isRunning(port: number): boolean {
  try {
    execSync(`curl -sf --max-time 3 http://localhost:${port}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

function updateState(updates: Record<string, unknown>): void {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
    Object.assign(state, updates);
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    warn(`Cannot update state: ${e}`);
  }
}

async function setupModels(): Promise<boolean> {
  log("Setting up AI models...");

  // Check Ollama
  if (!exec("which ollama")) {
    log("Installing Ollama via Homebrew...");
    exec("brew install ollama");
  }

  // Start Ollama if not running
  if (!isRunning(OLLAMA_PORT)) {
    log("Starting Ollama...");
    exec("brew services start ollama");
    // Wait up to 15s
    for (let i = 0; i < 15; i++) {
      if (isRunning(OLLAMA_PORT)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!isRunning(OLLAMA_PORT)) {
    err("Ollama is not running. Try: brew services start ollama");
    return false;
  }
  ok("Ollama running");

  // Read config to get model
  let selectedModel = "qwen2.5:7b";
  try {
    const config = yaml.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const primary = config?.model?.primary ?? "";
    if (primary.startsWith("ollama/")) {
      selectedModel = primary.replace("ollama/", "");
    }
  } catch {}

  // Pull models in parallel
  const models: string[] = [];
  const existing = exec("ollama list");

  if (!existing.includes("nomic-embed-text")) models.push("nomic-embed-text");
  if (!existing.includes(selectedModel)) models.push(selectedModel);

  if (models.length === 0) {
    ok("All models already downloaded");
    return true;
  }

  log(`Pulling ${models.length} model(s): ${models.join(", ")}...`);

  const pulls = models.map(
    (m) =>
      new Promise<void>((resolve) => {
        const proc = spawn("ollama", ["pull", m], { stdio: "pipe" });
        proc.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
        proc.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
        proc.on("close", (code) => {
          if (code === 0) ok(`${m} downloaded`);
          else warn(`${m} pull failed (code ${code})`);
          resolve();
        });
      })
  );

  await Promise.all(pulls);
  ok("Model setup complete");
  return true;
}

async function setupVectorDB(): Promise<boolean> {
  log("Setting up ChromaDB...");

  if (isRunning(CHROMADB_PORT)) {
    ok("ChromaDB already running on :8000");
    return true;
  }

  // Try Docker first
  try {
    execSync("docker info", { encoding: "utf-8", timeout: 5000 });
    log("Starting ChromaDB via Docker...");
    exec("docker rm -f chromadb 2>/dev/null || true");
    exec(
      `docker run -d --name chromadb --restart unless-stopped -p ${CHROMADB_PORT}:8000 -v ${MIRRORAI_HOME}/data/chromadb:/chroma/chroma chromadb/chroma:latest`
    );

    for (let i = 0; i < 30; i++) {
      if (isRunning(CHROMADB_PORT)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (isRunning(CHROMADB_PORT)) {
      ok("ChromaDB running (Docker)");
      return true;
    }
  } catch {}

  // Fallback: pip mode
  log("Starting ChromaDB via pip...");
  const repoDir = path.join(MIRRORAI_HOME, "app");
  const chromaBin = path.join(repoDir, ".venv", "bin", "chroma");

  if (!fs.existsSync(chromaBin)) {
    exec(`${repoDir}/.venv/bin/pip install chromadb`);
  }

  fs.mkdirSync(path.join(MIRRORAI_HOME, "data", "chromadb"), { recursive: true });

  const chromaProc = spawn(chromaBin, [
    "run",
    "--path", path.join(MIRRORAI_HOME, "data", "chromadb"),
    "--port", String(CHROMADB_PORT),
    "--host", "0.0.0.0",
  ], {
    detached: true,
    stdio: ["ignore", fs.openSync(path.join(MIRRORAI_HOME, "logs", "chromadb.log"), "a"), fs.openSync(path.join(MIRRORAI_HOME, "logs", "chromadb.log"), "a")],
  });
  chromaProc.unref();

  fs.writeFileSync(path.join(MIRRORAI_HOME, "chromadb.pid"), String(chromaProc.pid));

  for (let i = 0; i < 20; i++) {
    if (isRunning(CHROMADB_PORT)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (isRunning(CHROMADB_PORT)) {
    ok(`ChromaDB running (pip mode, PID: ${chromaProc.pid})`);
    return true;
  }

  err("ChromaDB failed to start. Check: ~/.mirrorai/logs/chromadb.log");
  return false;
}

export const setupCommand = new Command("setup")
  .description("Complete Phase 2 setup (models, vectordb, or full)")
  .argument("[component]", "Component to set up: models, vectordb, full", "full")
  .action(async (component: string) => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║   🪞 MirrorAI — Phase 2 Setup                ║");
    console.log("╚═══════════════════════════════════════════════╝");
    console.log("");

    const start = Date.now();
    let success = true;

    switch (component) {
      case "models":
        success = await setupModels();
        break;
      case "vectordb":
        success = await setupVectorDB();
        break;
      case "full":
        success = (await setupModels()) && (await setupVectorDB());
        break;
      default:
        err(`Unknown component: ${component}`);
        console.log("  Usage: mirrorai setup [models|vectordb|full]");
        process.exit(1);
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    console.log("");
    if (success) {
      updateState({ state: "READY", install_mode: "full" });
      console.log(`  ✅ Phase 2 setup complete! (${mins}m ${secs}s)`);
      console.log("  Run 'mirrorai doctor' to verify everything.");
    } else {
      console.log(`  ⚠ Setup completed with warnings (${mins}m ${secs}s)`);
      console.log("  Run 'mirrorai doctor' to diagnose issues.");
    }
    console.log("");
  });
