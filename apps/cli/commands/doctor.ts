/**
 * MirrorAI CLI — Health Check (Doctor) Command
 * Checks all services and reports status.
 */

import { Command } from "commander";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MIRRORAI_HOME = path.join(os.homedir(), ".mirrorai");
const STATE_PATH = path.join(MIRRORAI_HOME, "state.json");
const OLLAMA_PORT = 11434;
const CHROMADB_PORT = 8000;

function check(label: string, fn: () => boolean): boolean {
  const pad = label.padEnd(20);
  if (fn()) {
    console.log(`  ✅ ${pad} OK`);
    return true;
  }
  console.log(`  ❌ ${pad} FAIL`);
  return false;
}

function isPortOpen(port: number): boolean {
  try {
    execSync(`curl -sf --max-time 3 http://localhost:${port}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

function cmdExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export const doctorCommand = new Command("doctor")
  .description("Run health check on all MirrorAI services")
  .action(() => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║   🩺 MirrorAI — Health Check                 ║");
    console.log("╚═══════════════════════════════════════════════╝");
    console.log("");

    let pass = 0;
    let total = 0;

    // Core tools
    total++;
    if (check("Node.js", () => cmdExists("node"))) pass++;

    total++;
    if (check("Python", () => cmdExists("python3"))) pass++;

    total++;
    if (check("Git", () => cmdExists("git"))) pass++;

    // App directory
    total++;
    if (check("App directory", () => fs.existsSync(path.join(MIRRORAI_HOME, "app", "package.json")))) pass++;

    // Venv
    total++;
    if (check("Python venv", () => fs.existsSync(path.join(MIRRORAI_HOME, "app", ".venv", "bin", "python3")))) pass++;

    // Ollama
    total++;
    if (check("Ollama", () => isPortOpen(OLLAMA_PORT))) {
      pass++;

      // Check models
      try {
        const list = execSync("ollama list", { encoding: "utf-8" });
        total++;
        if (check("Embedding model", () => list.includes("nomic-embed-text"))) pass++;
        total++;
        if (check("Chat model", () => list.includes("qwen2.5"))) pass++;
      } catch {}
    } else {
      console.log("           → run: brew services start ollama");
    }

    // ChromaDB
    total++;
    if (check("ChromaDB", () => isPortOpen(CHROMADB_PORT))) {
      pass++;
    } else {
      console.log("           → run: mirrorai setup vectordb");
    }

    // Config files
    total++;
    if (check("Config", () => fs.existsSync(path.join(MIRRORAI_HOME, "mirrorai.config.yaml")))) pass++;

    total++;
    if (check(".env", () => fs.existsSync(path.join(MIRRORAI_HOME, ".env")))) pass++;

    // State
    let state: Record<string, unknown> = {};
    try {
      state = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
    } catch {}

    console.log("");
    console.log("──────────────────────────────────────────────");
    console.log(`  Health: ${pass}/${total} checks passed`);
    console.log(`  State:  ${(state.state as string) ?? "UNKNOWN"}`);
    console.log(`  Mode:   ${(state.install_mode as string) ?? "unknown"}`);

    if (pass === total) {
      console.log("  🟢 All systems operational!");
    } else if (pass >= total - 2) {
      console.log("  🟡 Mostly OK — some services need attention");
    } else {
      console.log("  🔴 Multiple issues found — run 'mirrorai setup full'");
    }
    console.log("");

    process.exit(pass === total ? 0 : 1);
  });
