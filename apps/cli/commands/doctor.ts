/**
 * MirrorAI CLI — Health Check (Doctor) Command
 * Checks all services and reports status.
 * Dynamically loads envKeys from export-* skill metadata.
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

/** Load all envKeys from export-* skill metadata */
async function loadSkillEnvKeys(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const projectRoot = process.cwd();
  const skillsDir = path.join(projectRoot, "packages", "openclaw-plugin", "skills");

  if (!fs.existsSync(skillsDir)) return result;

  const files = fs.readdirSync(skillsDir).filter(
    (f) => f.startsWith("export-") && f.endsWith(".ts")
  );

  for (const file of files) {
    try {
      const mod = await import(path.join(skillsDir, file));
      const meta = mod.metadata || mod.default?.metadata;
      if (meta?.id && meta?.envKeys?.length) {
        result[meta.id] = meta.envKeys;
      }
    } catch { /* skip */ }
  }

  return result;
}

export const doctorCommand = new Command("doctor")
  .description("Run health check on all MirrorAI services")
  .action(async () => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║   🩺 MirrorAI — Health Check                 ║");
    console.log("╚═══════════════════════════════════════════════╝");
    console.log("");

    let pass = 0;
    let total = 0;

    // Core tools
    total++; if (check("Node.js", () => cmdExists("node"))) pass++;
    total++; if (check("Python", () => cmdExists("python3"))) pass++;
    total++; if (check("Git", () => cmdExists("git"))) pass++;

    // App directory
    total++; if (check("App directory", () => fs.existsSync(path.join(MIRRORAI_HOME, "app", "package.json")))) pass++;

    // Venv
    total++; if (check("Python venv", () => fs.existsSync(path.join(MIRRORAI_HOME, "app", ".venv", "bin", "python3")))) pass++;

    // Ollama
    total++;
    if (check("Ollama", () => isPortOpen(OLLAMA_PORT))) {
      pass++;
      try {
        const list = execSync("ollama list", { encoding: "utf-8" });
        total++; if (check("Embedding model", () => list.includes("nomic-embed-text"))) pass++;
        total++; if (check("Chat model", () => list.includes("qwen2.5"))) pass++;
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
    total++; if (check("Config", () => fs.existsSync(path.join(MIRRORAI_HOME, "mirrorai.config.yaml")))) pass++;
    total++; if (check(".env", () => fs.existsSync(path.join(MIRRORAI_HOME, ".env")))) pass++;

    // Check envKeys from skill metadata
    const envFile = path.join(MIRRORAI_HOME, ".env");
    let envContent = "";
    if (fs.existsSync(envFile)) envContent = fs.readFileSync(envFile, "utf-8");

    const skillEnvKeys = await loadSkillEnvKeys();
    const state: Record<string, unknown> = {};
    try {
      Object.assign(state, JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")));
    } catch {}

    const enabledPlatforms = Object.entries((state.platforms || {}) as Record<string, any>)
      .filter(([_, conf]) => conf.enabled)
      .map(([name]) => name);

    if (enabledPlatforms.length > 0) {
      console.log("\n  Platform env vars:");
      for (const platform of enabledPlatforms) {
        const keys = skillEnvKeys[platform] || [];
        for (const key of keys) {
          const hasKey = envContent.includes(`${key}=`) && !envContent.includes(`${key}=\n`);
          total++;
          if (check(`  ${key}`, () => hasKey)) pass++;
        }
      }
    }

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
