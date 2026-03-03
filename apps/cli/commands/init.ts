/**
 * MirrorAI CLI — `mirrorai init`
 * Interactive setup wizard for first-time configuration.
 * Supports multi-platform selection with smart data input flow.
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

// ─── Platform Registry ─────────────────────────────────────────────────────
interface PlatformDef {
  value: string;
  name: string;
  icon: string;
  status: "ready" | "manual" | "coming_soon";
  hasAutoExport: boolean;
  hasBotReply: boolean;       // can this platform auto-reply via bot?
  manualExportGuide: string[];
}

const SOCIAL_PLATFORMS: PlatformDef[] = [
  {
    value: "telegram",
    name: "Telegram",
    icon: "✈️ ",
    status: "ready",
    hasAutoExport: true,
    hasBotReply: true,
    manualExportGuide: [
      "1. Open Telegram Desktop",
      "2. Settings → Advanced → Export Telegram Data",
      "3. Select: JSON format, Messages only",
      "4. Export and note the output folder path",
    ],
  },
  {
    value: "zalo",
    name: "Zalo",
    icon: "💬",
    status: "ready",
    hasAutoExport: true,
    hasBotReply: true,
    manualExportGuide: [],
  },
  {
    value: "facebook",
    name: "Facebook Messenger",
    icon: "📘",
    status: "manual",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [
      "1. Go to: facebook.com/dyi (Download Your Information)",
      "2. Select format: JSON",
      "3. Select: Messages only",
      "4. Click 'Request a download'",
      "5. Wait for email → download ZIP → extract",
    ],
  },
  {
    value: "instagram",
    name: "Instagram DMs",
    icon: "📸",
    status: "manual",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [
      "1. Go to: Instagram → Settings → Privacy & Security",
      "2. Click 'Request Download' → Format: JSON",
      "3. Wait for email → download ZIP → extract",
    ],
  },
  {
    value: "discord",
    name: "Discord",
    icon: "🎮",
    status: "manual",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [
      "1. Go to: Discord → User Settings → Privacy & Safety",
      "2. Click 'Request all of my Data'",
      "3. Wait for email → download ZIP → extract",
    ],
  },
  {
    value: "whatsapp",
    name: "WhatsApp",
    icon: "📱",
    status: "manual",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [
      "1. Open WhatsApp → select a chat",
      "2. Menu → More → Export Chat → Without Media",
      "3. Save the .txt file",
      "4. Repeat for each chat you want",
    ],
  },
  {
    value: "line",
    name: "LINE",
    icon: "🟢",
    status: "coming_soon",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [],
  },
  {
    value: "viber",
    name: "Viber",
    icon: "🟣",
    status: "coming_soon",
    hasAutoExport: false,
    hasBotReply: false,
    manualExportGuide: [],
  },
];

// ─── Types ──────────────────────────────────────────────────────────────────
interface PlatformState {
  enabled: boolean;
  configured: boolean;
  dataSource: "auto" | "file" | "pending"; // how data will be collected
  filePath?: string;                        // if user already has export file
}

interface InitState {
  state: string;
  platforms: Record<string, PlatformState>;
  model: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function findProjectRoot(): string {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [resolve(cliDir, ".."), resolve(cliDir, "..", ".."), process.cwd()];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "core", "telegram_exporter.py"))) return c;
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

function getPlatformDef(value: string): PlatformDef {
  return SOCIAL_PLATFORMS.find((p) => p.value === value)!;
}

/** Detect existing config/data for each platform */
interface DetectedState {
  hasSession: boolean;        // Telegram session exists (logged in)
  hasExportData: boolean;     // Export result.json exists
  exportMsgCount: number;     // Number of messages in existing export
  exportChats: number;        // Number of chats exported
  hasBotToken: boolean;       // Bot token configured in .env
  botTokenMasked: string;     // Masked token for display
  hasExportPath: boolean;     // Export path in .env
  exportPath: string;         // Actual export path
  selfName: string;           // Logged-in user name
}

function detectPlatformState(platform: string): DetectedState {
  const env = loadEnv();
  const state: DetectedState = {
    hasSession: false,
    hasExportData: false,
    exportMsgCount: 0,
    exportChats: 0,
    hasBotToken: false,
    botTokenMasked: "",
    hasExportPath: false,
    exportPath: "",
    selfName: "",
  };

  if (platform === "telegram") {
    // Check session
    const sessionFile = join(SESSION_DIR, "mirrorai_session.session");
    state.hasSession = existsSync(sessionFile);

    // Check export data
    const resultFile = join(EXPORT_DIR, "result.json");
    if (existsSync(resultFile)) {
      state.hasExportData = true;
      try {
        const data = JSON.parse(readFileSync(resultFile, "utf-8"));
        state.exportMsgCount = data.messages?.length || 0;
      } catch { /* ignore */ }
    }

    // Check export stats for chat count
    const statsFile = join(EXPORT_DIR, "export_stats.json");
    if (existsSync(statsFile)) {
      try {
        const stats = JSON.parse(readFileSync(statsFile, "utf-8"));
        state.exportChats = stats.chats_exported || 0;
        state.exportMsgCount = stats.total_messages || state.exportMsgCount;
        state.selfName = stats.self_name || "";
      } catch { /* ignore */ }
    }

    // Check bot token
    const token = env.TELEGRAM_BOT_TOKEN || "";
    if (token.length > 10) {
      state.hasBotToken = true;
      state.botTokenMasked = token.slice(0, 8) + "***" + token.slice(-4);
    }

    // Check export path
    state.exportPath = env.TELEGRAM_EXPORT_PATH || "";
    state.hasExportPath = !!state.exportPath && existsSync(state.exportPath);

    // Self name from env
    if (!state.selfName) state.selfName = env.TELEGRAM_SELF_NAME || "";
  }

  if (platform === "zalo") {
    const token = env.ZALO_BOT_TOKEN || "";
    if (token.length > 5) {
      state.hasBotToken = true;
      state.botTokenMasked = token.slice(0, 6) + "***";
    }
  }

  // Manual platforms — check env for export path
  if (["facebook", "instagram", "discord", "whatsapp"].includes(platform)) {
    const key = `${platform.toUpperCase()}_EXPORT_PATH`;
    state.exportPath = env[key] || "";
    state.hasExportPath = !!state.exportPath && existsSync(state.exportPath);
  }

  return state;
}

// ─── Auto-export: Telegram ──────────────────────────────────────────────────
async function autoExportTelegram(): Promise<boolean> {
  console.log("\n  ── Auto-exporting Telegram ──────────────────");

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
      console.error("  ✗ Failed. Run separately: mirrorai export");
      return false;
    }
  }

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

  if (!sessionExists) console.log("  OTP code will be sent via Telegram app.\n");

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

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMMAND
// ═════════════════════════════════════════════════════════════════════════════
export const initCommand = new Command("init")
  .description("Interactive setup wizard — configure platforms, models, and auto-export")
  .option("--platform <platform>", "Configure a specific platform only")
  .option("--non-interactive", "Use defaults without prompting")
  .action(async (options) => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║       MirrorAI — Setup Wizard          ║");
    console.log("╚════════════════════════════════════════╝\n");

    // Ensure directories
    for (const dir of [MIRRORAI_HOME, EXPORT_DIR, LOG_DIR, SESSION_DIR,
                        join(MIRRORAI_HOME, "data")]) {
      mkdirSync(dir, { recursive: true });
    }

    // .env template
    const envTemplate = join(process.cwd(), "config", ".env.template");
    if (!existsSync(ENV_FILE) && existsSync(envTemplate)) {
      copyFileSync(envTemplate, ENV_FILE);
      console.log("  ✓ Created .env from template");
    }

    if (options.nonInteractive) {
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: { telegram: { enabled: false, configured: false, dataSource: "pending" } },
        model: "ollama/qwen2.5:14b",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      console.log("\n  ✓ Default config saved. Edit ~/.mirrorai/.env then run: mirrorai ingest");
      return;
    }

    // ── Interactive mode ─────────────────────────────────────────────────
    try {
      const inquirer = await import("inquirer");
      const envUpdates: Record<string, string> = {};
      const platformStates: Record<string, PlatformState> = {};

      // ═════════════════════════════════════════════════════════════════
      // STEP 1/5 — Select social platforms (multi-checkbox)
      // ═════════════════════════════════════════════════════════════════
      console.log("  Step 1/5 — Select social platforms\n");

      const { selectedPlatforms } = await inquirer.default.prompt([{
        type: "checkbox",
        name: "selectedPlatforms",
        message: "Which platforms do you want to learn your chat style from?",
        choices: SOCIAL_PLATFORMS.map((p) => ({
          name: `${p.icon} ${p.name}` +
            (p.hasAutoExport ? " (Auto-export)" : "") +
            (p.status === "manual" ? " (Manual export)" : "") +
            (p.status === "coming_soon" ? " (Coming soon)" : ""),
          value: p.value,
          checked: p.value === "telegram",
          disabled: p.status === "coming_soon" ? "Coming soon" : false,
        })),
        validate: (input: string[]) => input.length > 0 || "Select at least one platform",
      }]);

      const selected = selectedPlatforms as string[];
      console.log(`\n  ✓ Selected ${selected.length} platform(s): ${selected.join(", ")}\n`);

      // ═════════════════════════════════════════════════════════════════
      // STEP 2/5 — Data source per platform (smart input)
      // ═════════════════════════════════════════════════════════════════
      console.log("  Step 2/5 — How to get your chat data\n");

      for (const pv of selected) {
        const def = getPlatformDef(pv);
        console.log(`  ── ${def.icon} ${def.name} ──────────────────────────`);

        // ── Telegram ─────────────────────────────────────────────────
        if (pv === "telegram") {
          const detected = detectPlatformState("telegram");

          // Show detected state
          if (detected.hasSession || detected.hasExportData || detected.hasBotToken) {
            console.log("  ┌─ Detected existing config ─────────────");
            if (detected.hasSession) {
              console.log(`  │  ✅ Logged in${detected.selfName ? `: ${detected.selfName}` : ""}`);
            }
            if (detected.hasExportData) {
              console.log(`  │  ✅ Export data: ${detected.exportMsgCount.toLocaleString()} messages from ${detected.exportChats} chats`);
            }
            if (detected.hasBotToken) {
              console.log(`  │  ✅ Bot token: ${detected.botTokenMasked}`);
            }
            console.log("  └──────────────────────────────────────────\n");
          }

          // Build choices based on detected state
          const telegramChoices: Array<{ name: string; value: string }> = [];

          if (detected.hasExportData) {
            telegramChoices.push({
              name: `Keep existing data (${detected.exportMsgCount.toLocaleString()} messages)`,
              value: "keep",
            });
            telegramChoices.push({
              name: `Re-export (overwrite — ${detected.hasSession ? "no OTP needed" : "phone + OTP"})`,
              value: "auto",
            });
          } else if (detected.hasSession) {
            telegramChoices.push({
              name: "Auto-export (already logged in — no OTP needed)",
              value: "auto",
            });
          } else {
            telegramChoices.push({
              name: "Auto-export (phone + OTP, recommended)",
              value: "auto",
            });
          }
          telegramChoices.push({
            name: "I already have a JSON export file",
            value: "file",
          });

          const { telegramSource } = await inquirer.default.prompt([{
            type: "list",
            name: "telegramSource",
            message: "How to get Telegram data?",
            choices: telegramChoices,
          }]);

          if (telegramSource === "keep") {
            platformStates.telegram = {
              enabled: true, configured: true, dataSource: "file",
              filePath: detected.exportPath || join(EXPORT_DIR, "result.json"),
            };
            console.log(`  ✓ Keeping existing export data\n`);
          } else if (telegramSource === "file") {
            const { filePath } = await inquirer.default.prompt([{
              type: "input",
              name: "filePath",
              message: "Path to Telegram JSON export file:",
              validate: (v: string) => {
                if (!v.trim()) return "Path is required";
                if (!existsSync(v.trim())) return `File not found: ${v}`;
                return true;
              },
            }]);
            envUpdates.TELEGRAM_EXPORT_PATH = resolve(filePath.trim());
            platformStates.telegram = { enabled: true, configured: true, dataSource: "file", filePath: resolve(filePath.trim()) };
            console.log(`  ✓ Will use: ${filePath.trim()}\n`);
          } else {
            platformStates.telegram = { enabled: true, configured: true, dataSource: "auto" };
            if (detected.hasSession) {
              console.log("  ✓ Will auto-export (already logged in)\n");
            } else {
              console.log("  ✓ Will auto-export after setup (phone + OTP)\n");
            }
          }
        }

        // ── Zalo ─────────────────────────────────────────────────────
        if (pv === "zalo") {
          const { zaloSource } = await inquirer.default.prompt([{
            type: "list",
            name: "zaloSource",
            message: "How to get Zalo data?",
            choices: [
              { name: "Personal account — QR login (recommended)", value: "qr" },
              { name: "Bot API token", value: "bot" },
            ],
          }]);

          if (zaloSource === "bot") {
            const { token } = await inquirer.default.prompt([{
              type: "input",
              name: "token",
              message: "Zalo Bot Token:",
              validate: (v: string) => v.trim().length > 5 || "Token looks too short",
            }]);
            envUpdates.ZALO_BOT_TOKEN = token.trim();
          }
          platformStates.zalo = { enabled: true, configured: true, dataSource: "auto" };
          console.log("  ✓ Zalo configured\n");
        }

        // ── Manual platforms (Facebook, Instagram, Discord, WhatsApp) ──
        if (["facebook", "instagram", "discord", "whatsapp"].includes(pv)) {
          const detected = detectPlatformState(pv);

          if (detected.hasExportPath) {
            console.log(`  ┌─ Detected existing config ─────────────`);
            console.log(`  │  ✅ Export path: ${detected.exportPath}`);
            console.log(`  └──────────────────────────────────────────\n`);
          }

          const manualChoices: Array<{ name: string; value: string }> = [];
          if (detected.hasExportPath) {
            manualChoices.push({
              name: `Keep existing (${detected.exportPath})`,
              value: "keep",
            });
          }
          manualChoices.push(
            { name: "Yes, I have the exported file/folder", value: "yes" },
            { name: "No, show me how to export", value: "no" },
          );

          const { hasFile } = await inquirer.default.prompt([{
            type: "list",
            name: "hasFile",
            message: `Do you have ${def.name} export data?`,
            choices: manualChoices,
          }]);

          if (hasFile === "keep") {
            platformStates[pv] = { enabled: true, configured: true, dataSource: "file", filePath: detected.exportPath };
            console.log(`  ✓ Keeping existing export path\n`);
          } else if (hasFile === "yes") {
            const { filePath } = await inquirer.default.prompt([{
              type: "input",
              name: "filePath",
              message: `Path to ${def.name} export:`,
              validate: (v: string) => {
                if (!v.trim()) return "Path is required";
                if (!existsSync(v.trim())) return `Not found: ${v}`;
                return true;
              },
            }]);
            const envKey = `${pv.toUpperCase()}_EXPORT_PATH`;
            envUpdates[envKey] = resolve(filePath.trim());
            platformStates[pv] = { enabled: true, configured: true, dataSource: "file", filePath: resolve(filePath.trim()) };
            console.log(`  ✓ Will use: ${filePath.trim()}\n`);
          } else {
            console.log("");
            console.log(`  ┌─ How to export ${def.name} data ─────────────`);
            for (const step of def.manualExportGuide) {
              console.log(`  │  ${step}`);
            }
            console.log(`  └──────────────────────────────────────────`);
            console.log(`  ℹ After exporting, run: mirrorai ingest --platform=${pv} --file=<path>\n`);
            platformStates[pv] = { enabled: true, configured: false, dataSource: "pending" };
          }
        }
      }

      // ═════════════════════════════════════════════════════════════════
      // STEP 3/5 — Bot config (for AI reply mode)
      // ═════════════════════════════════════════════════════════════════
      const botPlatforms = selected.filter((p) => getPlatformDef(p).hasBotReply);

      if (botPlatforms.length > 0) {
        console.log("  Step 3/5 — Bot config (for AI auto-reply)\n");

        // Detect existing bot tokens
        const tgDetected = detectPlatformState("telegram");
        const zaloDetected = detectPlatformState("zalo");
        const hasAnyToken = tgDetected.hasBotToken || zaloDetected.hasBotToken;

        if (hasAnyToken) {
          console.log("  ┌─ Detected existing bot config ─────────");
          if (tgDetected.hasBotToken) console.log(`  │  ✅ Telegram bot: ${tgDetected.botTokenMasked}`);
          if (zaloDetected.hasBotToken) console.log(`  │  ✅ Zalo bot: ${zaloDetected.botTokenMasked}`);
          console.log("  └──────────────────────────────────────────\n");
        } else {
          console.log("  ℹ To let your AI clone reply on your behalf, MirrorAI needs bot tokens.");
          console.log("  You can skip this now and configure later.\n");
        }

        const { configBot } = await inquirer.default.prompt([{
          type: "list",
          name: "configBot",
          message: hasAnyToken
            ? "Bot tokens already configured. What to do?"
            : "Configure bot tokens now? (needed for auto-reply)",
          choices: hasAnyToken
            ? [
                { name: "Keep existing tokens", value: "keep" },
                { name: "Update tokens", value: "update" },
                { name: "Skip (configure later)", value: "skip" },
              ]
            : [
                { name: "Configure now", value: "update" },
                { name: "Skip (configure later)", value: "skip" },
              ],
        }]);

        if (configBot === "update") {
          if (botPlatforms.includes("telegram")) {
            const { token } = await inquirer.default.prompt([{
              type: "input",
              name: "token",
              message: `Telegram Bot Token${tgDetected.hasBotToken ? ` (current: ${tgDetected.botTokenMasked})` : " (from @BotFather)"}:`,
              validate: (v: string) => v.trim().length > 10 || "Token looks too short",
            }]);
            envUpdates.TELEGRAM_BOT_TOKEN = token.trim();
            console.log("  ✓ Telegram bot token saved");
          }
          if (botPlatforms.includes("zalo") && !envUpdates.ZALO_BOT_TOKEN) {
            const { token } = await inquirer.default.prompt([{
              type: "input",
              name: "token",
              message: `Zalo Bot/OA Token${zaloDetected.hasBotToken ? ` (current: ${zaloDetected.botTokenMasked})` : ""}:`,
            }]);
            if (token.trim()) {
              envUpdates.ZALO_BOT_TOKEN = token.trim();
              console.log("  ✓ Zalo bot token saved");
            }
          }
          console.log("");
        } else if (configBot === "keep") {
          console.log("  ✓ Keeping existing bot tokens\n");
        } else {
          console.log("  ℹ Skip. Configure later: mirrorai init --platform=telegram\n");
        }
      }

      // ═════════════════════════════════════════════════════════════════
      // STEP 4/5 — Choose AI model
      // ═════════════════════════════════════════════════════════════════
      console.log("  Step 4/5 — Choose AI model\n");

      const { model } = await inquirer.default.prompt([{
        type: "list",
        name: "model",
        message: "Choose AI model for your clone:",
        choices: [
          { name: "Ollama — qwen2.5:14b (Local, recommended)", value: "ollama/qwen2.5:14b" },
          { name: "Ollama — qwen2.5:7b (Local, lighter)",      value: "ollama/qwen2.5:7b" },
          { name: "Ollama — llama3.3:8b (Local)",               value: "ollama/llama3.3:8b" },
          { name: "Claude Sonnet (Cloud, needs API key)",       value: "anthropic/claude-sonnet-4-6" },
          { name: "GPT-4o (Cloud, needs API key)",              value: "openai/gpt-4o" },
        ],
      }]);

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
        platforms: platformStates,
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      // ═════════════════════════════════════════════════════════════════
      // STEP 5/5 — Auto-export data
      // ═════════════════════════════════════════════════════════════════
      const autoExportPlatforms = selected.filter(
        (p) => platformStates[p]?.dataSource === "auto" && getPlatformDef(p).hasAutoExport
      );
      const fileReadyPlatforms = selected.filter(
        (p) => platformStates[p]?.dataSource === "file"
      );
      const exportResults: Record<string, boolean> = {};

      if (autoExportPlatforms.length > 0) {
        console.log("\n  Step 5/5 — Export data now\n");

        const { exportNow } = await inquirer.default.prompt([{
          type: "confirm",
          name: "exportNow",
          message: `Auto-export data from ${autoExportPlatforms.map((p) => getPlatformDef(p).name).join(", ")} now?`,
          default: true,
        }]);

        if (exportNow) {
          for (const pv of autoExportPlatforms) {
            if (pv === "telegram") {
              exportResults.telegram = await autoExportTelegram();
            }
            if (pv === "zalo") {
              console.log("\n  ── Zalo Auto-Export ──────────────────────");
              console.log("  ℹ Run: mirrorai export --platform=zalo");
              console.log("  (QR login will be prompted)\n");
              exportResults.zalo = false;
            }
          }
        } else {
          console.log("  ℹ Export later: mirrorai export\n");
        }
      }

      // Mark file-ready platforms as exported
      for (const pv of fileReadyPlatforms) {
        exportResults[pv] = true;
      }

      // ═════════════════════════════════════════════════════════════════
      // SUMMARY
      // ═════════════════════════════════════════════════════════════════
      const exported = Object.entries(exportResults).filter(([, v]) => v).map(([k]) => k);
      const pending = selected.filter((p) => !exported.includes(p));

      console.log("\n╔══════════════════════════════════════════════════════╗");
      console.log("║              MirrorAI — Setup Complete                ║");
      console.log("╠══════════════════════════════════════════════════════╣");

      // Platform status table
      for (const pv of selected) {
        const def = getPlatformDef(pv);
        const ps = platformStates[pv];
        let statusIcon = "⏳";
        let statusText = "Pending export";
        if (exported.includes(pv)) {
          statusIcon = "✅";
          statusText = ps?.filePath ? `File: ${ps.filePath}` : "Exported";
        } else if (ps?.dataSource === "auto") {
          statusText = "Auto-export available";
        }
        const line = `${statusIcon} ${def.icon} ${def.name}`;
        console.log(`║  ${line.padEnd(25)} ${statusText.padEnd(26)}║`);
      }

      console.log("╠══════════════════════════════════════════════════════╣");
      console.log(`║  Model  : ${model.padEnd(40)}║`);
      console.log(`║  Config : ~/.mirrorai/                               ║`);
      console.log("╠══════════════════════════════════════════════════════╣");

      // Next steps
      if (exported.length > 0 && pending.length === 0) {
        console.log("║  Next: mirrorai ingest                                ║");
      } else if (exported.length > 0) {
        console.log("║  Next: mirrorai ingest  (for ready platforms)         ║");
        console.log(`║        mirrorai export  (for ${pending.join(", ").padEnd(21)})║`);
      } else {
        console.log("║  Next: mirrorai export                                ║");
      }
      console.log("╚══════════════════════════════════════════════════════╝\n");

      // Update final state
      state.state = exported.length > 0 ? "DATA_EXPORTED" : "CONFIGURING_PLATFORM";
      state.updatedAt = new Date().toISOString();
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    } catch (err) {
      console.log("Interactive mode requires: npm install inquirer");
      console.log("Run with --non-interactive for default setup");
      console.error(err);
    }
  });
