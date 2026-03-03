/**
 * MirrorAI CLI — `mirrorai init`
 * Interactive setup wizard — auto-discovers platforms from export-* skills.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const ENV_FILE = join(MIRRORAI_HOME, ".env");
const EXPORT_DIR = join(MIRRORAI_HOME, "data", "exports");
const SESSION_DIR = join(MIRRORAI_HOME, "sessions");
const LOG_DIR = join(MIRRORAI_HOME, "logs");

// ─── Types ──────────────────────────────────────────────────────────────────
interface PlatformState {
  enabled: boolean;
  configured: boolean;
  dataSource: "auto" | "file" | "pending";
  filePath?: string;
}

interface InitState {
  state: string;
  platforms: Record<string, PlatformState>;
  model: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportSkillMeta {
  id: string;
  displayName: string;
  icon: string;
  status: "ready" | "manual" | "coming_soon";
  hasAutoExport: boolean;
  hasBotReply: boolean;
  manualExportGuide: string[];
  envKeys: string[];
}

interface ExportSkill {
  metadata: ExportSkillMeta;
  detect: (env: Record<string, string>, home: string) => any;
  setup: (inquirer: any, ctx: any) => Promise<PlatformState>;
  autoExport?: (env: Record<string, string>, projectRoot: string) => Promise<boolean>;
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

/** Scan packages/openclaw-plugin/skills/export-*.ts to discover platforms */
async function discoverPlatforms(): Promise<ExportSkill[]> {
  const projectRoot = findProjectRoot();
  const skillsDir = join(projectRoot, "packages", "openclaw-plugin", "skills");
  const skills: ExportSkill[] = [];

  if (!existsSync(skillsDir)) return skills;

  const files = readdirSync(skillsDir).filter(
    (f) => f.startsWith("export-") && f.endsWith(".ts")
  );

  for (const file of files.sort()) {
    try {
      const mod = await import(join(skillsDir, file));
      if (mod.metadata || mod.default?.metadata) {
        skills.push(mod.default || mod);
      }
    } catch (err) {
      console.error(`  Warning: Failed to load skill ${file}: ${err}`);
    }
  }

  return skills;
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
    for (const dir of [MIRRORAI_HOME, EXPORT_DIR, LOG_DIR, SESSION_DIR, join(MIRRORAI_HOME, "data")]) {
      mkdirSync(dir, { recursive: true });
    }

    // .env template
    const envTemplate = join(process.cwd(), "config", ".env.template");
    if (!existsSync(ENV_FILE) && existsSync(envTemplate)) {
      copyFileSync(envTemplate, ENV_FILE);
      console.log("  ✓ Created .env from template");
    }

    // Discover platforms from export-* skills
    const skills = await discoverPlatforms();

    if (skills.length === 0) {
      console.error("  ✗ No export skills found. Check packages/openclaw-plugin/skills/export-*.ts");
      process.exit(1);
    }

    if (options.nonInteractive) {
      const platformStates: Record<string, PlatformState> = {};
      for (const skill of skills) {
        platformStates[skill.metadata.id] = { enabled: false, configured: false, dataSource: "pending" };
      }
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: platformStates,
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
      const env = loadEnv();
      const envUpdates: Record<string, string> = {};
      const platformStates: Record<string, PlatformState> = {};

      // ═══ STEP 1/5 — Select social platforms ═══
      console.log("  Step 1/5 — Select social platforms\n");

      const { selectedPlatforms } = await inquirer.default.prompt([{
        type: "checkbox",
        name: "selectedPlatforms",
        message: "Which platforms do you want to learn your chat style from?",
        choices: skills.map((s) => ({
          name: `${s.metadata.icon} ${s.metadata.displayName}` +
            (s.metadata.hasAutoExport ? " (Auto-export)" : "") +
            (s.metadata.status === "manual" ? " (Manual export)" : "") +
            (s.metadata.status === "coming_soon" ? " (Coming soon)" : ""),
          value: s.metadata.id,
          checked: s.metadata.id === "telegram",
          disabled: s.metadata.status === "coming_soon" ? "Coming soon" : false,
        })),
        validate: (input: string[]) => input.length > 0 || "Select at least one platform",
      }]);

      const selected = selectedPlatforms as string[];
      console.log(`\n  ✓ Selected ${selected.length} platform(s): ${selected.join(", ")}\n`);

      // ═══ STEP 2/5 — Data source per platform (smart input) ═══
      console.log("  Step 2/5 — How to get your chat data\n");

      for (const platformId of selected) {
        const skill = skills.find((s) => s.metadata.id === platformId)!;
        const meta = skill.metadata;
        console.log(`  ── ${meta.icon} ${meta.displayName} ──────────────────────────`);

        const detected = skill.detect(env, MIRRORAI_HOME);

        // Show detected state
        if (detected.hasSession || detected.hasExportData || detected.hasBotToken) {
          console.log("  ┌─ Detected existing config ─────────────");
          if (detected.hasSession) console.log(`  │  ✅ Logged in${detected.selfName ? `: ${detected.selfName}` : ""}`);
          if (detected.hasExportData) console.log(`  │  ✅ Export data: ${detected.exportMsgCount.toLocaleString()} messages from ${detected.exportChats} chats`);
          if (detected.hasBotToken) console.log(`  │  ✅ Bot token: ${detected.botTokenMasked}`);
          console.log("  └──────────────────────────────────────────\n");
        }

        const result = await skill.setup(inquirer, { env, envUpdates, detected });
        platformStates[platformId] = result;
        console.log(`  ✓ ${meta.displayName} configured\n`);
      }

      // ═══ STEP 3/5 — Bot config ═══
      const botPlatforms = selected.filter((p) => {
        const s = skills.find((s) => s.metadata.id === p);
        return s?.metadata.hasBotReply;
      });

      if (botPlatforms.length > 0) {
        console.log("  Step 3/5 — Bot config (for AI auto-reply)\n");

        const detections = Object.fromEntries(
          botPlatforms.map((p) => [p, skills.find((s) => s.metadata.id === p)!.detect(env, MIRRORAI_HOME)])
        );
        const hasAnyToken = Object.values(detections).some((d: any) => d.hasBotToken);

        if (hasAnyToken) {
          console.log("  ┌─ Detected existing bot config ─────────");
          for (const [p, d] of Object.entries(detections)) {
            if ((d as any).hasBotToken) console.log(`  │  ✅ ${p} bot: ${(d as any).botTokenMasked}`);
          }
          console.log("  └──────────────────────────────────────────\n");
        } else {
          console.log("  ℹ To let your AI clone reply on your behalf, MirrorAI needs bot tokens.");
          console.log("  You can skip this now and configure later.\n");
        }

        const { configBot } = await inquirer.default.prompt([{
          type: "list",
          name: "configBot",
          message: hasAnyToken ? "Bot tokens already configured. What to do?" : "Configure bot tokens now?",
          choices: hasAnyToken
            ? [{ name: "Keep existing tokens", value: "keep" }, { name: "Update tokens", value: "update" }, { name: "Skip", value: "skip" }]
            : [{ name: "Configure now", value: "update" }, { name: "Skip (configure later)", value: "skip" }],
        }]);

        if (configBot === "update") {
          if (botPlatforms.includes("telegram")) {
            const { token } = await inquirer.default.prompt([{
              type: "input", name: "token",
              message: "Telegram Bot Token (from @BotFather):",
              validate: (v: string) => v.trim().length > 10 || "Token looks too short",
            }]);
            envUpdates.TELEGRAM_BOT_TOKEN = token.trim();
          }
          if (botPlatforms.includes("zalo") && !envUpdates.ZALO_BOT_TOKEN) {
            const { token } = await inquirer.default.prompt([{
              type: "input", name: "token", message: "Zalo Bot/OA Token:",
            }]);
            if (token.trim()) envUpdates.ZALO_BOT_TOKEN = token.trim();
          }
          console.log("");
        }
      }

      // ═══ STEP 4/5 — Choose AI model ═══
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
        const { apiKey } = await inquirer.default.prompt([{ type: "password", name: "apiKey", message: "Anthropic API Key:" }]);
        envUpdates.ANTHROPIC_API_KEY = apiKey;
      } else if (model.startsWith("openai/")) {
        const { apiKey } = await inquirer.default.prompt([{ type: "password", name: "apiKey", message: "OpenAI API Key:" }]);
        envUpdates.OPENAI_API_KEY = apiKey;
      }

      // Save .env
      if (Object.keys(envUpdates).length > 0) saveEnvVars(envUpdates);

      // Save state
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: platformStates,
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      // ═══ STEP 5/5 — Auto-export data ═══
      const autoExportPlatforms = selected.filter((p) => {
        const skill = skills.find((s) => s.metadata.id === p);
        return platformStates[p]?.dataSource === "auto" && skill?.metadata.hasAutoExport && skill?.autoExport;
      });
      const fileReadyPlatforms = selected.filter((p) => platformStates[p]?.dataSource === "file");
      const exportResults: Record<string, boolean> = {};

      if (autoExportPlatforms.length > 0) {
        console.log("\n  Step 5/5 — Export data now\n");

        const names = autoExportPlatforms.map((p) => skills.find((s) => s.metadata.id === p)!.metadata.displayName);
        const { exportNow } = await inquirer.default.prompt([{
          type: "confirm", name: "exportNow",
          message: `Auto-export data from ${names.join(", ")} now?`,
          default: true,
        }]);

        if (exportNow) {
          const projectRoot = findProjectRoot();
          const allEnv = { ...env, ...envUpdates };
          for (const platformId of autoExportPlatforms) {
            const skill = skills.find((s) => s.metadata.id === platformId)!;
            if (skill.autoExport) {
              exportResults[platformId] = await skill.autoExport(allEnv, projectRoot);
            }
          }
        } else {
          console.log("  ℹ Export later: mirrorai export\n");
        }
      }

      for (const pv of fileReadyPlatforms) exportResults[pv] = true;

      // ═══ SUMMARY ═══
      const exported = Object.entries(exportResults).filter(([, v]) => v).map(([k]) => k);
      const pending = selected.filter((p) => !exported.includes(p));

      console.log("\n╔══════════════════════════════════════════════════════╗");
      console.log("║              MirrorAI — Setup Complete                ║");
      console.log("╠══════════════════════════════════════════════════════╣");

      for (const platformId of selected) {
        const skill = skills.find((s) => s.metadata.id === platformId)!;
        const ps = platformStates[platformId];
        let statusIcon = "⏳";
        let statusText = "Pending export";
        if (exported.includes(platformId)) {
          statusIcon = "✅";
          statusText = ps?.filePath ? `File: ${ps.filePath}` : "Exported";
        } else if (ps?.dataSource === "auto") {
          statusText = "Auto-export available";
        }
        const line = `${statusIcon} ${skill.metadata.icon} ${skill.metadata.displayName}`;
        console.log(`║  ${line.padEnd(25)} ${statusText.padEnd(26)}║`);
      }

      console.log("╠══════════════════════════════════════════════════════╣");
      console.log(`║  Model  : ${model.padEnd(40)}║`);
      console.log(`║  Config : ~/.mirrorai/                               ║`);
      console.log("╠══════════════════════════════════════════════════════╣");

      if (exported.length > 0 && pending.length === 0) {
        console.log("║  Next: mirrorai ingest                                ║");
      } else if (exported.length > 0) {
        console.log("║  Next: mirrorai ingest  (for ready platforms)         ║");
        console.log(`║        mirrorai export  (for ${pending.join(", ").padEnd(21)})║`);
      } else {
        console.log("║  Next: mirrorai export                                ║");
      }
      console.log("╚══════════════════════════════════════════════════════╝\n");

      state.state = exported.length > 0 ? "DATA_EXPORTED" : "CONFIGURING_PLATFORM";
      state.updatedAt = new Date().toISOString();
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    } catch (err) {
      console.log("Interactive mode requires: npm install inquirer");
      console.log("Run with --non-interactive for default setup");
      console.error(err);
    }
  });
