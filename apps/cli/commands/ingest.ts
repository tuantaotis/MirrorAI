/**
 * MirrorAI CLI — `mirrorai ingest`
 * Trigger data collection from configured platforms.
 * Delegates to export-* skill handlers for platform-specific logic.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");

function findProjectRoot(): string {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [resolve(cliDir, ".."), resolve(cliDir, "..", ".."), process.cwd()];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "core", "run_pipeline.py"))) return c;
  }
  return candidates[0];
}

function loadEnv(): Record<string, string> {
  const envFile = join(MIRRORAI_HOME, ".env");
  const vars: Record<string, string> = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  }
  return vars;
}

/** Load export skill metadata to get envKeys */
async function loadSkillMeta(platformId: string) {
  const projectRoot = findProjectRoot();
  const skillFile = join(projectRoot, "packages", "openclaw-plugin", "skills", `export-${platformId}.ts`);
  if (!existsSync(skillFile)) return null;
  try {
    const mod = await import(skillFile);
    return mod.metadata || mod.default?.metadata || null;
  } catch {
    return null;
  }
}

export const ingestCommand = new Command("ingest")
  .description("Collect and process chat data from configured platforms")
  .option("--platform <platform>", "Ingest from a specific platform only")
  .option("--file <path>", "Import from a specific export file")
  .option("--dry-run", "Show what would be ingested without actually doing it")
  .action(async (options) => {
    console.log("\n[MirrorAI] Starting data ingestion...\n");

    if (!existsSync(STATE_FILE)) {
      console.error("✗ Not initialized. Run: mirrorai init");
      process.exit(1);
    }

    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    const envVars = loadEnv();

    // Determine which platforms to ingest
    const platforms = options.platform
      ? [options.platform]
      : Object.entries(state.platforms)
          .filter(([_, conf]: [string, any]) => conf.enabled)
          .map(([name]) => name);

    if (platforms.length === 0) {
      console.error("✗ No platforms configured. Run: mirrorai init");
      process.exit(1);
    }

    console.log(`Platforms: ${platforms.join(", ")}`);

    if (options.dryRun) {
      console.log("\n[Dry Run] Would ingest from:", platforms);
      return;
    }

    state.state = "COLLECTING_DATA";
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    const projectRoot = findProjectRoot();
    let pipelineSuccess = false;

    for (const platform of platforms) {
      console.log(`\n── ${platform.toUpperCase()} ──────────────────────`);

      // Find export file from options, env, or auto-export result
      const envKey = `${platform.toUpperCase()}_EXPORT_PATH`;
      const autoExportFile = join(MIRRORAI_HOME, "data", "exports", "result.json");
      const exportPath = options.file
        || envVars[envKey]
        || process.env[envKey]
        || (existsSync(autoExportFile) ? autoExportFile : null);

      if (!exportPath || !existsSync(exportPath)) {
        const meta = await loadSkillMeta(platform);
        console.log("  No export file found.\n");
        console.log("  Option 1 (auto): mirrorai export");
        if (meta?.manualExportGuide?.length) {
          console.log(`  Option 2 (manual):`);
          for (const step of meta.manualExportGuide) {
            console.log(`    ${step}`);
          }
        }
        console.log(`  Then: mirrorai ingest --platform=${platform} --file=<path>\n`);
        continue;
      }

      console.log(`Export file: ${exportPath}`);

      const selfId = envVars[`${platform.toUpperCase()}_SELF_NAME`]
        || envVars[`${platform.toUpperCase()}_SELF_ID`]
        || state.selfId || "Me";

      console.log(`Self ID: ${selfId}`);

      const cmd = [
        "python3", "-m", "packages.core.run_pipeline",
        "--export-path", `"${resolve(exportPath)}"`,
        "--self-id", `"${selfId}"`,
        "--data-dir", `"${MIRRORAI_HOME}"`,
        "--platform", platform,
      ].join(" ");

      console.log(`Running: ${cmd}\n`);

      try {
        const output = execSync(cmd, {
          cwd: projectRoot,
          stdio: ["inherit", "pipe", "inherit"],
          env: { ...process.env, ...envVars, PYTHONPATH: projectRoot },
          timeout: 600_000,
        });

        const stdout = output.toString();
        for (const line of stdout.split("\n")) {
          if (line.startsWith("__PIPELINE_STATS__")) {
            try {
              const stats = JSON.parse(line.replace("__PIPELINE_STATS__", ""));
              console.log(`\n── PIPELINE RESULTS ────────────────────`);
              console.log(`  Messages normalized: ${stats.steps?.normalize?.messages || "?"}`);
              console.log(`  Messages cleaned:    ${stats.steps?.clean?.after || "?"}`);
              console.log(`  Chunks created:      ${stats.steps?.chunk?.chunks || "?"}`);
              console.log(`  Vectors indexed:     ${stats.steps?.index?.indexed || "?"}`);
              console.log(`  Total time:          ${stats.total_duration_s || "?"}s`);
              pipelineSuccess = stats.status === "success";
            } catch { /* ignore */ }
          } else if (line.trim()) {
            console.log(line);
          }
        }
      } catch (err: any) {
        console.error(`\n✗ Pipeline failed: ${err.message}`);
        console.error("  Common issues:");
        console.error("    - Python packages: pip install chromadb httpx pyyaml");
        console.error("    - Ollama: ollama serve");
        console.error("    - ChromaDB: docker run -p 8000:8000 chromadb/chroma");
      }
    }

    state.state = pipelineSuccess ? "READY" : "CONFIGURING_PLATFORM";
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    if (pipelineSuccess) {
      console.log("\n════════════════════════════════════════");
      console.log(" ✓ Ingestion complete!");
      console.log(" Next: mirrorai mirror --enable");
      console.log("════════════════════════════════════════\n");
    } else {
      console.log("\n════════════════════════════════════════");
      console.log(" ✗ Ingestion incomplete. Fix errors above and retry.");
      console.log("════════════════════════════════════════\n");
    }
  });
