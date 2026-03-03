/**
 * MirrorAI CLI — `mirrorai ingest`
 * Trigger data collection from configured platforms.
 * Runs the full pipeline: normalize → clean → chunk → embed → index → persona → SOUL.md
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");

/** Find the project root (where packages/core/ lives) */
function findProjectRoot(): string {
  // Try relative to CLI dist/ location
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [
    resolve(cliDir, ".."),          // apps/cli/../../ = project root
    resolve(cliDir, "..", ".."),     // fallback
    process.cwd(),                   // current dir
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "core", "run_pipeline.py"))) {
      return c;
    }
  }
  return candidates[0];
}

export const ingestCommand = new Command("ingest")
  .description("Collect and process chat data from configured platforms")
  .option("--platform <platform>", "Ingest from a specific platform only")
  .option("--file <path>", "Import from a specific export file")
  .option("--dry-run", "Show what would be ingested without actually doing it")
  .action(async (options) => {
    console.log("\n[MirrorAI] Starting data ingestion...\n");

    // Load state
    if (!existsSync(STATE_FILE)) {
      console.error("✗ Not initialized. Run: mirrorai init");
      process.exit(1);
    }

    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));

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
      console.log("[Dry Run] No changes made.");
      return;
    }

    // Load .env for bot token etc.
    const envFile = join(MIRRORAI_HOME, ".env");
    const envVars: Record<string, string> = {};
    if (existsSync(envFile)) {
      const envContent = readFileSync(envFile, "utf-8");
      for (const line of envContent.split("\n")) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) envVars[match[1].trim()] = match[2].trim();
      }
    }

    // Update state → COLLECTING_DATA
    state.state = "COLLECTING_DATA";
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    const projectRoot = findProjectRoot();
    let pipelineSuccess = false;

    for (const platform of platforms) {
      console.log(`\n── ${platform.toUpperCase()} ──────────────────────`);

      if (platform === "telegram") {
        const exportPath = options.file
          || envVars.TELEGRAM_EXPORT_PATH
          || process.env.TELEGRAM_EXPORT_PATH;

        // Check for auto-exported file
        const autoExportFile = join(MIRRORAI_HOME, "data", "exports", "result.json");
        const finalExportPath = exportPath
          || (existsSync(autoExportFile) ? autoExportFile : null);

        if (!finalExportPath || !existsSync(finalExportPath)) {
          console.log("  No export file found.\n");
          console.log("  Option 1 (auto): mirrorai export");
          console.log("    → Tự động tải chat history từ Telegram (cần API credentials)\n");
          console.log("  Option 2 (manual): Export từ Telegram Desktop:");
          console.log("    → Settings → Advanced → Export Telegram Data → JSON");
          console.log("    → mirrorai ingest --platform=telegram --file=<path>\n");
          continue;
        }

        console.log(`Export file: ${finalExportPath}`);

        // Determine self ID from .env or state
        const selfId = envVars.TELEGRAM_SELF_NAME
          || envVars.TELEGRAM_SELF_ID
          || state.selfId
          || "Me";

        console.log(`Self ID: ${selfId}`);
        console.log(`Data dir: ${MIRRORAI_HOME}`);
        console.log("");

        // Run Python pipeline orchestrator
        const cmd = [
          "python3", "-m", "packages.core.run_pipeline",
          "--export-path", `"${resolve(finalExportPath)}"`,
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
            timeout: 600_000, // 10 min max
          });

          const stdout = output.toString();
          // Print pipeline output
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
              } catch { /* ignore parse errors */ }
            } else if (line.trim()) {
              console.log(line);
            }
          }
        } catch (err: any) {
          console.error(`\n✗ Pipeline failed: ${err.message}`);
          console.error("  Check logs: ~/.mirrorai/logs/pipeline.log");
          console.error("  Common issues:");
          console.error("    - Python packages not installed: pip install chromadb httpx pyyaml");
          console.error("    - Ollama not running: ollama serve");
          console.error("    - ChromaDB not running: docker run -p 8000:8000 chromadb/chroma");
        }
      }

      if (platform === "zalo") {
        console.log("Zalo connector: coming soon");
        console.log("  Currently supports Telegram only");
      }
    }

    // Update state
    state.state = pipelineSuccess ? "READY" : "CONFIGURING_PLATFORM";
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    if (pipelineSuccess) {
      console.log("\n════════════════════════════════════════");
      console.log(" ✓ Ingestion complete!");
      console.log(" Data: ~/.mirrorai/data/");
      console.log(" SOUL: ~/.mirrorai/data/SOUL.md");
      console.log(" Next: mirrorai mirror --enable");
      console.log("════════════════════════════════════════\n");
    } else {
      console.log("\n════════════════════════════════════════");
      console.log(" ✗ Ingestion incomplete. Fix errors above and retry.");
      console.log("════════════════════════════════════════\n");
    }
  });
