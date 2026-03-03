/**
 * MirrorAI — export-telegram Skill.
 * Auto-export Telegram chat history via Telethon.
 * Supports session persistence (login once, remember forever).
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const EXPORT_DIR = join(MIRRORAI_HOME, "data", "exports");
const SESSION_DIR = join(MIRRORAI_HOME, "sessions");

// ─── OpenClaw Export Skill Metadata ─────────────────────────────────────────
export const metadata = {
  id: "telegram",
  displayName: "Telegram",
  icon: "✈️ ",
  status: "ready" as const,
  hasAutoExport: true,
  hasBotReply: true,
  manualExportGuide: [
    "1. Open Telegram Desktop",
    "2. Settings → Advanced → Export Telegram Data",
    "3. Select: JSON format, Messages only",
    "4. Export and note the output folder path",
  ],
  envKeys: [
    "TELEGRAM_EXPORT_PATH",
    "TELEGRAM_SELF_NAME",
    "TELEGRAM_SELF_ID",
    "TELEGRAM_BOT_TOKEN",
  ],
};

/** Detect existing Telegram config/data */
export function detect(env: Record<string, string>, _home: string) {
  const sessionFile = join(SESSION_DIR, "mirrorai_session.session");
  const resultFile = join(EXPORT_DIR, "result.json");
  const statsFile = join(EXPORT_DIR, "export_stats.json");

  const result = {
    hasSession: existsSync(sessionFile),
    hasExportData: existsSync(resultFile),
    exportMsgCount: 0,
    exportChats: 0,
    hasBotToken: false,
    botTokenMasked: "",
    hasExportPath: false,
    exportPath: "",
    selfName: "",
  };

  if (result.hasExportData) {
    try {
      const data = JSON.parse(readFileSync(resultFile, "utf-8"));
      result.exportMsgCount = data.messages?.length || 0;
    } catch { /* ignore */ }
  }

  if (existsSync(statsFile)) {
    try {
      const stats = JSON.parse(readFileSync(statsFile, "utf-8"));
      result.exportChats = stats.chats_exported || 0;
      result.exportMsgCount = stats.total_messages || result.exportMsgCount;
      result.selfName = stats.self_name || "";
    } catch { /* ignore */ }
  }

  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (token.length > 10) {
    result.hasBotToken = true;
    result.botTokenMasked = token.slice(0, 8) + "***" + token.slice(-4);
  }

  result.exportPath = env.TELEGRAM_EXPORT_PATH || "";
  result.hasExportPath = !!result.exportPath && existsSync(result.exportPath);
  if (!result.selfName) result.selfName = env.TELEGRAM_SELF_NAME || "";

  return result;
}

/** Interactive setup prompts for Telegram */
export async function setup(inquirer: any, ctx: {
  env: Record<string, string>;
  envUpdates: Record<string, string>;
  detected: ReturnType<typeof detect>;
}) {
  const { detected, envUpdates } = ctx;

  // Build choices based on detected state
  const choices: Array<{ name: string; value: string }> = [];

  if (detected.hasExportData) {
    choices.push({
      name: `Keep existing data (${detected.exportMsgCount.toLocaleString()} messages)`,
      value: "keep",
    });
    choices.push({
      name: `Re-export (overwrite — ${detected.hasSession ? "no OTP needed" : "phone + OTP"})`,
      value: "auto",
    });
  } else if (detected.hasSession) {
    choices.push({ name: "Auto-export (already logged in — no OTP needed)", value: "auto" });
  } else {
    choices.push({ name: "Auto-export (phone + OTP, recommended)", value: "auto" });
  }
  choices.push({ name: "I already have a JSON export file", value: "file" });

  const { source } = await inquirer.default.prompt([{
    type: "list",
    name: "source",
    message: "How to get Telegram data?",
    choices,
  }]);

  if (source === "keep") {
    return {
      enabled: true, configured: true, dataSource: "file" as const,
      filePath: detected.exportPath || join(EXPORT_DIR, "result.json"),
    };
  }

  if (source === "file") {
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
    return { enabled: true, configured: true, dataSource: "file" as const, filePath: resolve(filePath.trim()) };
  }

  // Auto-export
  return { enabled: true, configured: true, dataSource: "auto" as const };
}

/** Run auto-export via Telethon */
export async function autoExport(env: Record<string, string>, projectRoot: string): Promise<boolean> {
  console.log("\n  ── Auto-exporting Telegram ──────────────────");

  const sessionFile = join(SESSION_DIR, "mirrorai_session.session");
  const sessionExists = existsSync(sessionFile);

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
      const answers = await inquirer.default.prompt([{
        type: "input",
        name: "phone",
        message: "Telegram phone number (e.g. +84901234567):",
        validate: (v: string) =>
          (v.startsWith("+") && v.length >= 10) || "Invalid format. Use: +84...",
      }]);
      phone = answers.phone;
    } catch {
      console.error("  ✗ Failed. Run separately: mirrorai export");
      return false;
    }
  }

  try { execSync("python3 -c 'import telethon'", { stdio: "ignore" }); }
  catch {
    console.log("  Installing Telethon...");
    try { execSync("pip3 install telethon", { stdio: "inherit" }); }
    catch { console.error("  ✗ Install failed. Run: pip3 install telethon"); return false; }
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
    execSync(cmdParts.join(" "), {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, ...env, PYTHONPATH: projectRoot },
      timeout: 600_000,
    });

    const statsFile = join(EXPORT_DIR, "export_stats.json");
    if (existsSync(statsFile)) {
      try {
        const stats = JSON.parse(readFileSync(statsFile, "utf-8"));
        return (stats.chats_exported || 0) > 0;
      } catch { /* ignore */ }
    }
    return false;
  } catch (err: any) {
    console.error(`  ✗ Export failed: ${err.message}`);
    console.error("  Run separately: mirrorai export");
    return false;
  }
}

export default { metadata, detect, setup, autoExport };
