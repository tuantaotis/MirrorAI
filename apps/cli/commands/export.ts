/**
 * MirrorAI CLI — `mirrorai export`
 * Auto-export Telegram chat history. Only needs phone + OTP on first use.
 * Auto-uses saved session afterwards — no re-login needed.
 * 100% local — data never leaves your machine.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const EXPORT_DIR = join(MIRRORAI_HOME, "data", "exports");
const SESSION_DIR = join(MIRRORAI_HOME, "sessions");
const SESSION_FILE = join(SESSION_DIR, "mirrorai_session.session");

function findProjectRoot(): string {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [
    resolve(cliDir, ".."),
    resolve(cliDir, "..", ".."),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "core", "telegram_exporter.py"))) {
      return c;
    }
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

function hasSession(): boolean {
  return existsSync(SESSION_FILE);
}

export const exportCommand = new Command("export")
  .description("Auto-export Telegram chat history (login once, remembers you)")
  .option("--phone <phone>", "Telegram phone number (+84...)")
  .option("--limit <number>", "Max messages per chat", "5000")
  .option("--filter <type>", "Chat filter: all | private | group", "all")
  .option("--auto-ingest", "Auto-run ingest after export")
  .option("--logout", "Clear login session")
  .action(async (options) => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║  MirrorAI — Auto Export (100% Local)   ║");
    console.log("╚════════════════════════════════════════╝\n");

    // Handle logout
    if (options.logout) {
      if (hasSession()) {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(SESSION_FILE);
        console.log("  ✓ Session cleared. Will need to re-login next time.\n");
      } else {
        console.log("  No session found.\n");
      }
      return;
    }

    const env = loadEnv();

    // Ensure dirs
    mkdirSync(EXPORT_DIR, { recursive: true });
    mkdirSync(SESSION_DIR, { recursive: true });

    // Check if session exists → skip phone prompt entirely
    let phone = options.phone;
    const sessionExists = hasSession();

    if (sessionExists) {
      console.log("  ✓ Previously logged in — skipping login");
      console.log(`  ℹ Use --logout to switch accounts\n`);
    } else {
      // First time — need phone (do NOT save phone to .env)
      if (!phone) {
        console.log("  First time use — Telegram login required");
        console.log("  (Only needed once, remembered afterwards)\n");
        try {
          const inquirer = await import("inquirer");
          const answers = await inquirer.default.prompt([
            {
              type: "input",
              name: "phone",
              message: "Telegram phone number (e.g. +84901234567):",
              validate: (v: string) => (v.startsWith("+") && v.length >= 10) || "Invalid format. Use: +84...",
            },
          ]);
          phone = answers.phone;
        } catch {
          console.error("  ✗ Retry with: mirrorai export --phone +84901234567");
          process.exit(1);
        }
      }
    }

    // Ensure telethon installed
    try {
      execSync("python3 -c 'import telethon'", { stdio: "ignore" });
    } catch {
      console.log("  Installing Telethon...");
      try {
        execSync("pip3 install telethon", { stdio: "inherit" });
      } catch {
        console.error("  ✗ Install failed. Run: pip3 install telethon");
        process.exit(1);
      }
    }

    const projectRoot = findProjectRoot();

    // Build command — phone optional if session exists
    const cmdParts = [
      "python3", "-m", "packages.core.telegram_exporter",
      "--output", `"${EXPORT_DIR}"`,
      "--limit", options.limit,
      "--filter", options.filter,
      "--session-dir", `"${SESSION_DIR}"`,
    ];

    if (phone) {
      cmdParts.push("--phone", `"${phone}"`);
    }

    const cmd = cmdParts.join(" ");

    if (!sessionExists) {
      console.log("  OTP code will be sent via Telegram app.\n");
    }

    try {
      const output = execSync(cmd, {
        cwd: projectRoot,
        stdio: ["inherit", "pipe", "inherit"],
        env: { ...process.env, ...env, PYTHONPATH: projectRoot },
        timeout: 600_000,
      });

      const stdout = output.toString();
      let exportStats: any = null;

      for (const line of stdout.split("\n")) {
        if (line.startsWith("__EXPORT_STATS__")) {
          try {
            exportStats = JSON.parse(line.replace("__EXPORT_STATS__", ""));
          } catch { /* ignore */ }
        } else if (line.trim()) {
          console.log(line);
        }
      }

      if (exportStats) {
        // Update state + .env
        if (existsSync(STATE_FILE) && exportStats.combined_file) {
          const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
          state.telegramExportPath = exportStats.combined_file;
          if (exportStats.self_name) state.selfId = exportStats.self_name;
          state.updatedAt = new Date().toISOString();
          writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        }

        const envFile = join(MIRRORAI_HOME, ".env");
        let envContent = existsSync(envFile) ? readFileSync(envFile, "utf-8") : "";

        const updates: Record<string, string> = {
          TELEGRAM_EXPORT_PATH: exportStats.combined_file || "",
          TELEGRAM_SELF_NAME: exportStats.self_name || "",
        };

        for (const [key, value] of Object.entries(updates)) {
          if (!value) continue;
          if (envContent.includes(`${key}=`)) {
            envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
          } else {
            envContent += `\n${key}=${value}`;
          }
        }
        writeFileSync(envFile, envContent.trim() + "\n");

        if (options.autoIngest) {
          console.log("\n  Auto-ingesting data...\n");
          try {
            execSync(
              `node "${join(dirname(fileURLToPath(import.meta.url)), "..", "index.js")}" ingest --platform=telegram`,
              { stdio: "inherit", cwd: projectRoot, env: { ...process.env, ...env } }
            );
          } catch (err: any) {
            console.error(`  ✗ Ingest failed: ${err.message}`);
          }
        } else {
          console.log("\n  Next step: mirrorai ingest\n");
        }
      }
    } catch (err: any) {
      console.error(`\n  ✗ Export failed: ${err.message}`);
      console.error("  Retry: mirrorai export");
      process.exit(1);
    }
  });
