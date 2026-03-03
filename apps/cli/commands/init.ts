/**
 * MirrorAI CLI — `mirrorai init`
 * Interactive setup wizard for first-time configuration.
 * Supports multi-platform selection with auto-export.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const ENV_FILE = join(MIRRORAI_HOME, ".env");
const EXPORT_DIR = join(MIRRORAI_HOME, "data", "exports");
const SESSION_DIR = join(MIRRORAI_HOME, "sessions");
const LOG_DIR = join(MIRRORAI_HOME, "logs");

/** All supported social platforms with metadata */
const SOCIAL_PLATFORMS = [
  {
    value: "telegram",
    name: "Telegram",
    icon: "✈️",
    status: "ready" as const,
    description: "Auto-export via MTProto (phone + OTP)",
    exportMethod: "auto",
  },
  {
    value: "zalo",
    name: "Zalo",
    icon: "💬",
    status: "ready" as const,
    description: "QR login or Bot API token",
    exportMethod: "auto",
  },
  {
    value: "facebook",
    name: "Facebook Messenger",
    icon: "📘",
    status: "manual" as const,
    description: "Manual export from Facebook Settings → Download Your Information",
    exportMethod: "manual",
  },
  {
    value: "instagram",
    name: "Instagram DMs",
    icon: "📸",
    status: "manual" as const,
    description: "Manual export from Instagram Settings → Download Your Data",
    exportMethod: "manual",
  },
  {
    value: "discord",
    name: "Discord",
    icon: "🎮",
    status: "manual" as const,
    description: "Manual export using Discord Data Package request",
    exportMethod: "manual",
  },
  {
    value: "whatsapp",
    name: "WhatsApp",
    icon: "📱",
    status: "manual" as const,
    description: "Manual export: Chat → Export Chat → Without Media",
    exportMethod: "manual",
  },
  {
    value: "line",
    name: "LINE",
    icon: "🟢",
    status: "coming_soon" as const,
    description: "Coming soon",
    exportMethod: "none",
  },
  {
    value: "viber",
    name: "Viber",
    icon: "🟣",
    status: "coming_soon" as const,
    description: "Coming soon",
    exportMethod: "none",
  },
];

interface InitState {
  state: string;
  platforms: Record<string, { enabled: boolean; configured: boolean; exportMethod: string }>;
  selectedExports: string[];
  model: string;
  createdAt: string;
  updatedAt: string;
}

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
  const vars: Record<string, string> = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  }
  return vars;
}

function saveEnvVars(updates: Record<string, string>): void {
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    if (content.includes(`${key}=`)) {
      content = content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  writeFileSync(ENV_FILE, content.trim() + "\n");
}

/** Show manual export instructions for a platform */
function showManualExportGuide(platform: string): void {
  const guides: Record<string, string[]> = {
    facebook: [
      "  How to export Facebook Messenger data:",
      "  1. Go to: facebook.com/dyi (Download Your Information)",
      "  2. Select format: JSON",
      "  3. Select: Messages only",
      "  4. Click 'Request a download'",
      "  5. Wait for email notification → download ZIP",
      "  6. Extract and run:",
      `     mirrorai ingest --platform=facebook --file=<path/to/messages/>`,
    ],
    instagram: [
      "  How to export Instagram DMs:",
      "  1. Go to: Instagram → Settings → Privacy & Security",
      "  2. Click 'Request Download' → Format: JSON",
      "  3. Wait for email → download ZIP",
      "  4. Extract and run:",
      `     mirrorai ingest --platform=instagram --file=<path/to/messages/>`,
    ],
    discord: [
      "  How to export Discord data:",
      "  1. Go to: Discord → Settings → Privacy & Safety",
      "  2. Click 'Request all of my Data'",
      "  3. Wait for email → download ZIP",
      "  4. Extract and run:",
      `     mirrorai ingest --platform=discord --file=<path/to/messages/>`,
    ],
    whatsapp: [
      "  How to export WhatsApp chats:",
      "  1. Open WhatsApp → select a chat",
      "  2. Menu (⋮) → More → Export Chat → Without Media",
      "  3. Save the .txt file",
      "  4. Repeat for each chat you want to include",
      "  5. Run:",
      `     mirrorai ingest --platform=whatsapp --file=<path/to/chat.txt>`,
    ],
  };

  const guide = guides[platform];
  if (guide) {
    console.log("");
    guide.forEach((line) => console.log(line));
    console.log("");
  }
}

/** Auto-export Telegram data (reuses export command logic) */
async function autoExportTelegram(): Promise<boolean> {
  console.log("\n  ── Telegram Auto-Export ──────────────────────");

  const sessionFile = join(SESSION_DIR, "mirrorai_session.session");
  const sessionExists = existsSync(sessionFile);
  const env = loadEnv();
  const projectRoot = findProjectRoot();

  mkdirSync(EXPORT_DIR, { recursive: true });
  mkdirSync(SESSION_DIR, { recursive: true });

  let phone: string | undefined;

  if (sessionExists) {
    console.log("  ✓ Previously logged in — skipping login");
  } else {
    console.log("  First time — Telegram login required");
    console.log("  (Only needed once, remembered afterwards)\n");
    try {
      const inquirer = await import("inquirer");
      const answers = await inquirer.default.prompt([
        {
          type: "input",
          name: "phone",
          message: "Telegram phone number (e.g. +84901234567):",
          validate: (v: string) =>
            (v.startsWith("+") && v.length >= 10) || "Invalid format. Use: +84...",
        },
      ]);
      phone = answers.phone;
    } catch {
      console.error("  ✗ Failed to prompt. Run separately: mirrorai export");
      return false;
    }
  }

  // Ensure telethon
  try {
    execSync("python3 -c 'import telethon'", { stdio: "ignore" });
  } catch {
    console.log("  Installing Telethon...");
    try {
      execSync("pip3 install telethon", { stdio: "inherit" });
    } catch {
      console.error("  ✗ Install failed. Run: pip3 install telethon");
      return false;
    }
  }

  const cmdParts = [
    "python3", "-m", "packages.core.telegram_exporter",
    "--output", `"${EXPORT_DIR}"`,
    "--limit", "5000",
    "--filter", "all",
    "--session-dir", `"${SESSION_DIR}"`,
  ];
  if (phone) cmdParts.push("--phone", `"${phone}"`);

  if (!sessionExists) {
    console.log("  OTP code will be sent via Telegram app.\n");
  }

  try {
    const output = execSync(cmdParts.join(" "), {
      cwd: projectRoot,
      stdio: ["inherit", "pipe", "inherit"],
      env: { ...process.env, ...env, PYTHONPATH: projectRoot },
      timeout: 600_000,
    });

    const stdout = output.toString();
    let success = false;

    for (const line of stdout.split("\n")) {
      if (line.startsWith("__EXPORT_STATS__")) {
        try {
          const stats = JSON.parse(line.replace("__EXPORT_STATS__", ""));
          success = true;
          console.log(`  ✓ Exported ${stats.total_messages || "?"} messages from ${stats.total_chats || "?"} chats`);

          // Save to .env
          saveEnvVars({
            TELEGRAM_EXPORT_PATH: stats.combined_file || "",
            TELEGRAM_SELF_NAME: stats.self_name || "",
          });
        } catch { /* ignore */ }
      } else if (line.trim()) {
        console.log(line);
      }
    }
    return success;
  } catch (err: any) {
    console.error(`  ✗ Export failed: ${err.message}`);
    console.error("  Run separately: mirrorai export");
    return false;
  }
}

export const initCommand = new Command("init")
  .description("Interactive setup wizard — configure platforms, models, and auto-export")
  .option("--platform <platform>", "Configure a specific platform only")
  .option("--non-interactive", "Use defaults without prompting")
  .action(async (options) => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║       MirrorAI — Setup Wizard          ║");
    console.log("╚════════════════════════════════════════╝\n");

    // Ensure home directory exists
    for (const dir of [MIRRORAI_HOME, EXPORT_DIR, LOG_DIR, SESSION_DIR]) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(MIRRORAI_HOME)) {
      console.log(`✓ Created MirrorAI home: ${MIRRORAI_HOME}`);
    }

    // Copy .env template if not exists
    const envTemplate = join(process.cwd(), "config", ".env.template");
    if (!existsSync(ENV_FILE) && existsSync(envTemplate)) {
      copyFileSync(envTemplate, ENV_FILE);
      console.log(`✓ Created .env from template`);
    }

    if (options.nonInteractive) {
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: {
          telegram: { enabled: false, configured: false, exportMethod: "auto" },
          zalo: { enabled: false, configured: false, exportMethod: "auto" },
        },
        selectedExports: [],
        model: "ollama/qwen2.5:14b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      console.log("\n✓ Default configuration saved");
      console.log("  Edit ~/.mirrorai/.env to add platform tokens");
      console.log("  Then run: mirrorai ingest");
      return;
    }

    // ── Interactive mode ───────────────────────────────────────────────
    try {
      const inquirer = await import("inquirer");

      // ═══════════════════════════════════════════════════════════════
      // STEP 1: Choose social platforms (multi-select)
      // ═══════════════════════════════════════════════════════════════
      console.log("  Step 1/4 — Choose your social platforms\n");

      const platformChoices = SOCIAL_PLATFORMS.map((p) => {
        let suffix = "";
        if (p.status === "ready") suffix = " (Auto-export)";
        else if (p.status === "manual") suffix = " (Manual export)";
        else if (p.status === "coming_soon") suffix = " (Coming soon)";

        return {
          name: `${p.icon}  ${p.name}${suffix}`,
          value: p.value,
          checked: p.value === "telegram",
          disabled: p.status === "coming_soon" ? "Coming soon" : false,
        };
      });

      const { selectedPlatforms } = await inquirer.default.prompt([
        {
          type: "checkbox",
          name: "selectedPlatforms",
          message: "Select platforms to export your chat data from:",
          choices: platformChoices,
          validate: (input: string[]) =>
            input.length > 0 || "Select at least one platform",
        },
      ]);

      // Show selection summary
      const readyPlatforms = (selectedPlatforms as string[]).filter((p) => {
        const info = SOCIAL_PLATFORMS.find((s) => s.value === p);
        return info?.status === "ready";
      });
      const manualPlatforms = (selectedPlatforms as string[]).filter((p) => {
        const info = SOCIAL_PLATFORMS.find((s) => s.value === p);
        return info?.status === "manual";
      });

      console.log(`\n  Selected: ${(selectedPlatforms as string[]).length} platform(s)`);
      if (readyPlatforms.length > 0) {
        console.log(`  ✓ Auto-export: ${readyPlatforms.join(", ")}`);
      }
      if (manualPlatforms.length > 0) {
        console.log(`  ℹ Manual export: ${manualPlatforms.join(", ")} (instructions will be shown)`);
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 2: Configure each selected platform
      // ═══════════════════════════════════════════════════════════════
      console.log("\n  Step 2/4 — Configure platforms\n");

      const platformConfig: Record<string, { enabled: boolean; configured: boolean; exportMethod: string }> = {};
      const envUpdates: Record<string, string> = {};

      for (const platform of selectedPlatforms as string[]) {
        const info = SOCIAL_PLATFORMS.find((s) => s.value === platform)!;
        console.log(`\n  ── ${info.icon}  ${info.name} ──────────────────────`);

        if (platform === "telegram") {
          const answers = await inquirer.default.prompt([
            {
              type: "input",
              name: "botToken",
              message: "Telegram Bot Token (from @BotFather):",
              validate: (input: string) =>
                input.length > 10 ? true : "Token looks too short. Get one from @BotFather on Telegram",
            },
          ]);
          envUpdates.TELEGRAM_BOT_TOKEN = answers.botToken;
          platformConfig.telegram = { enabled: true, configured: true, exportMethod: "auto" };
          console.log("  ✓ Telegram configured");
        }

        if (platform === "zalo") {
          const { zaloMode } = await inquirer.default.prompt([
            {
              type: "list",
              name: "zaloMode",
              message: "Zalo connection mode:",
              choices: [
                { name: "Personal account (QR login)", value: "personal" },
                { name: "Bot API (token)", value: "bot" },
              ],
            },
          ]);
          if (zaloMode === "bot") {
            const { botToken } = await inquirer.default.prompt([
              { type: "input", name: "botToken", message: "Zalo Bot Token:" },
            ]);
            envUpdates.ZALO_BOT_TOKEN = botToken;
          } else {
            console.log("  ℹ QR login will be prompted when you run export");
          }
          platformConfig.zalo = { enabled: true, configured: true, exportMethod: "auto" };
          console.log("  ✓ Zalo configured");
        }

        // Manual-export platforms — just mark as enabled, show guide later
        if (["facebook", "instagram", "discord", "whatsapp"].includes(platform)) {
          platformConfig[platform] = { enabled: true, configured: true, exportMethod: "manual" };
          console.log(`  ✓ ${info.name} enabled — export guide will be shown after setup`);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 3: Choose AI model
      // ═══════════════════════════════════════════════════════════════
      console.log("\n  Step 3/4 — Choose AI model\n");

      const { model } = await inquirer.default.prompt([
        {
          type: "list",
          name: "model",
          message: "Choose AI model for your clone:",
          choices: [
            { name: "Ollama — qwen2.5:14b (Local, recommended)", value: "ollama/qwen2.5:14b" },
            { name: "Ollama — qwen2.5:7b (Local, lighter)", value: "ollama/qwen2.5:7b" },
            { name: "Ollama — llama3.3:8b (Local)", value: "ollama/llama3.3:8b" },
            { name: "Claude Sonnet (Cloud, needs API key)", value: "anthropic/claude-sonnet-4-6" },
            { name: "GPT-4o (Cloud, needs API key)", value: "openai/gpt-4o" },
          ],
        },
      ]);

      if (model.startsWith("anthropic/")) {
        const { apiKey } = await inquirer.default.prompt([
          { type: "password", name: "apiKey", message: "Anthropic API Key:" },
        ]);
        envUpdates.ANTHROPIC_API_KEY = apiKey;
      } else if (model.startsWith("openai/")) {
        const { apiKey } = await inquirer.default.prompt([
          { type: "password", name: "apiKey", message: "OpenAI API Key:" },
        ]);
        envUpdates.OPENAI_API_KEY = apiKey;
      }

      // Save .env
      if (Object.keys(envUpdates).length > 0) {
        saveEnvVars(envUpdates);
      }

      // Save state
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: platformConfig,
        selectedExports: selectedPlatforms as string[],
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      // ═══════════════════════════════════════════════════════════════
      // STEP 4: Auto-export data
      // ═══════════════════════════════════════════════════════════════
      console.log("\n  Step 4/4 — Export chat data\n");

      const exportResults: Record<string, boolean> = {};

      // Ask if user wants to export now
      if (readyPlatforms.length > 0) {
        const { exportNow } = await inquirer.default.prompt([
          {
            type: "confirm",
            name: "exportNow",
            message: `Auto-export data from ${readyPlatforms.join(", ")} now?`,
            default: true,
          },
        ]);

        if (exportNow) {
          for (const platform of readyPlatforms) {
            if (platform === "telegram") {
              exportResults.telegram = await autoExportTelegram();
            }
            if (platform === "zalo") {
              console.log("\n  ── Zalo Auto-Export ──────────────────────");
              console.log("  ℹ Zalo export will be available in `mirrorai export --platform=zalo`");
              console.log("  (QR login required on first use)");
              exportResults.zalo = false;
            }
          }
        } else {
          console.log("  ℹ You can export later with: mirrorai export");
        }
      }

      // Show manual export guides for manual platforms
      if (manualPlatforms.length > 0) {
        console.log("\n  ── Manual Export Guides ──────────────────────");
        for (const platform of manualPlatforms) {
          const info = SOCIAL_PLATFORMS.find((s) => s.value === platform)!;
          console.log(`\n  ${info.icon}  ${info.name}:`);
          showManualExportGuide(platform);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SUMMARY
      // ═══════════════════════════════════════════════════════════════
      const successExports = Object.entries(exportResults).filter(([_, v]) => v).map(([k]) => k);
      const pendingExports = (selectedPlatforms as string[]).filter(
        (p) => !successExports.includes(p)
      );

      console.log("\n╔════════════════════════════════════════════════════╗");
      console.log("║            MirrorAI — Setup Complete               ║");
      console.log("╠════════════════════════════════════════════════════╣");
      console.log(`║  Platforms : ${(selectedPlatforms as string[]).join(", ").padEnd(36)}║`);
      console.log(`║  Model     : ${model.padEnd(36)}║`);
      console.log(`║  Config    : ~/.mirrorai/                          ║`);

      if (successExports.length > 0) {
        console.log(`║  Exported  : ${successExports.join(", ").padEnd(36)}║`);
      }
      if (pendingExports.length > 0) {
        console.log(`║  Pending   : ${pendingExports.join(", ").padEnd(36)}║`);
      }

      console.log("╠════════════════════════════════════════════════════╣");

      if (successExports.length > 0) {
        console.log("║  Next: mirrorai ingest                             ║");
      } else if (readyPlatforms.length > 0) {
        console.log("║  Next: mirrorai export                             ║");
      } else {
        console.log("║  Next: Export data manually, then mirrorai ingest  ║");
      }
      console.log("╚════════════════════════════════════════════════════╝\n");

      // Update state
      state.state = successExports.length > 0 ? "DATA_EXPORTED" : "CONFIGURING_PLATFORM";
      state.updatedAt = new Date().toISOString();
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    } catch (err) {
      console.log("Interactive mode requires: npm install inquirer");
      console.log("Run with --non-interactive for default setup");
      console.error(err);
    }
  });
