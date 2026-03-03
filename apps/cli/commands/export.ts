/**
 * MirrorAI CLI — `mirrorai export`
 * Auto-export chat history from Telegram via MTProto API (Telethon).
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

export const exportCommand = new Command("export")
  .description("Auto-export chat history from Telegram (100% local, private)")
  .option("--platform <platform>", "Platform to export from", "telegram")
  .option("--limit <number>", "Max messages per chat", "5000")
  .option("--filter <type>", "Chat filter: all | private | group", "all")
  .option("--auto-ingest", "Automatically run ingest after export")
  .action(async (options) => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║  MirrorAI — Auto Export (100% Local)   ║");
    console.log("╚════════════════════════════════════════╝\n");

    if (options.platform !== "telegram") {
      console.error(`✗ Platform "${options.platform}" not supported yet. Only telegram.`);
      process.exit(1);
    }

    // Load env
    const env = loadEnv();

    // Check Telegram API credentials
    const apiId = env.TELEGRAM_API_ID || process.env.TELEGRAM_API_ID;
    const apiHash = env.TELEGRAM_API_HASH || process.env.TELEGRAM_API_HASH;
    const phone = env.TELEGRAM_PHONE || process.env.TELEGRAM_PHONE;

    if (!apiId || !apiHash || !phone) {
      console.log("  Cần Telegram API credentials để auto-export.\n");
      console.log("  Bước 1: Vào https://my.telegram.org → API development tools");
      console.log("  Bước 2: Tạo app → lấy api_id và api_hash");
      console.log("  Bước 3: Thêm vào ~/.mirrorai/.env:\n");
      console.log("    TELEGRAM_API_ID=12345678");
      console.log("    TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890");
      console.log("    TELEGRAM_PHONE=+84901234567\n");

      // Try interactive input
      try {
        const inquirer = await import("inquirer");
        const answers = await inquirer.default.prompt([
          {
            type: "input",
            name: "apiId",
            message: "Telegram API ID:",
            validate: (v: string) => /^\d+$/.test(v) || "Phải là số",
          },
          {
            type: "input",
            name: "apiHash",
            message: "Telegram API Hash:",
            validate: (v: string) => v.length >= 20 || "Hash quá ngắn",
          },
          {
            type: "input",
            name: "phone",
            message: "Số điện thoại (+84...):",
            validate: (v: string) => v.startsWith("+") || "Phải bắt đầu bằng +",
          },
        ]);

        // Save to .env
        const envFile = join(MIRRORAI_HOME, ".env");
        let content = existsSync(envFile) ? readFileSync(envFile, "utf-8") : "";
        content += `\nTELEGRAM_API_ID=${answers.apiId}\n`;
        content += `TELEGRAM_API_HASH=${answers.apiHash}\n`;
        content += `TELEGRAM_PHONE=${answers.phone}\n`;
        writeFileSync(envFile, content);

        env.TELEGRAM_API_ID = answers.apiId;
        env.TELEGRAM_API_HASH = answers.apiHash;
        env.TELEGRAM_PHONE = answers.phone;

        console.log("\n  ✓ Credentials saved to ~/.mirrorai/.env\n");
      } catch {
        console.error("  ✗ Thêm credentials vào .env rồi chạy lại: mirrorai export");
        process.exit(1);
      }
    }

    // Ensure export dir exists
    mkdirSync(EXPORT_DIR, { recursive: true });

    // Check telethon installed
    try {
      execSync("python3 -c 'import telethon'", { stdio: "ignore" });
    } catch {
      console.log("  Installing Telethon...");
      try {
        execSync("pip3 install telethon", { stdio: "inherit" });
      } catch {
        console.error("  ✗ Failed to install telethon. Run: pip3 install telethon");
        process.exit(1);
      }
    }

    const projectRoot = findProjectRoot();
    const finalApiId = env.TELEGRAM_API_ID || apiId!;
    const finalApiHash = env.TELEGRAM_API_HASH || apiHash!;
    const finalPhone = env.TELEGRAM_PHONE || phone!;

    const cmd = [
      "python3", "-m", "packages.core.telegram_exporter",
      "--api-id", finalApiId,
      "--api-hash", finalApiHash,
      "--phone", `"${finalPhone}"`,
      "--output", `"${EXPORT_DIR}"`,
      "--limit", options.limit,
      "--filter", options.filter,
      "--session-dir", `"${join(MIRRORAI_HOME, "sessions")}"`,
    ].join(" ");

    console.log("  Connecting to Telegram...");
    console.log("  (Lần đầu sẽ yêu cầu mã OTP qua Telegram)\n");

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
        console.log("\n══════════════════════════════════════════");
        console.log(` ✓ Export complete!`);
        console.log(`   Chats: ${exportStats.chats_exported}`);
        console.log(`   Messages: ${exportStats.total_messages}`);
        console.log(`   Data: ${EXPORT_DIR}/`);
        console.log(`   Combined: ${exportStats.combined_file}`);

        // Update state with export path
        if (existsSync(STATE_FILE) && exportStats.combined_file) {
          const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
          state.telegramExportPath = exportStats.combined_file;
          state.updatedAt = new Date().toISOString();
          writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

          // Also save to .env
          const envFile = join(MIRRORAI_HOME, ".env");
          let envContent = existsSync(envFile) ? readFileSync(envFile, "utf-8") : "";
          // Replace or add TELEGRAM_EXPORT_PATH
          if (envContent.includes("TELEGRAM_EXPORT_PATH=")) {
            envContent = envContent.replace(
              /TELEGRAM_EXPORT_PATH=.*/,
              `TELEGRAM_EXPORT_PATH=${exportStats.combined_file}`
            );
          } else {
            envContent += `\nTELEGRAM_EXPORT_PATH=${exportStats.combined_file}\n`;
          }
          writeFileSync(envFile, envContent);
        }

        if (options.autoIngest) {
          console.log(`\n   Auto-ingesting...`);
          console.log("══════════════════════════════════════════\n");
          // Re-run ingest with the exported file
          execSync(
            `node ${join(dirname(fileURLToPath(import.meta.url)), "..", "index.js")} ingest --platform=telegram --file="${exportStats.combined_file}"`,
            { stdio: "inherit", cwd: projectRoot, env: { ...process.env, ...env } }
          );
        } else {
          console.log(`\n   Next: mirrorai ingest --platform=telegram`);
          console.log("══════════════════════════════════════════\n");
        }
      }
    } catch (err: any) {
      console.error(`\n✗ Export failed: ${err.message}`);
      console.error("  Common issues:");
      console.error("    - Wrong API credentials → check my.telegram.org");
      console.error("    - OTP expired → retry");
      console.error("    - Telethon not installed → pip3 install telethon");
      process.exit(1);
    }
  });
