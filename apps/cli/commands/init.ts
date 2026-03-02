/**
 * MirrorAI CLI — `mirrorai init`
 * Interactive setup wizard for first-time configuration.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const ENV_FILE = join(MIRRORAI_HOME, ".env");

interface InitState {
  state: string;
  platforms: Record<string, { enabled: boolean; configured: boolean }>;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export const initCommand = new Command("init")
  .description("Interactive setup wizard — configure platforms, models, and auth")
  .option("--platform <platform>", "Configure a specific platform only")
  .option("--non-interactive", "Use defaults without prompting")
  .action(async (options) => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║       MirrorAI — Setup Wizard          ║");
    console.log("╚════════════════════════════════════════╝\n");

    // Ensure home directory exists
    if (!existsSync(MIRRORAI_HOME)) {
      mkdirSync(MIRRORAI_HOME, { recursive: true });
      mkdirSync(join(MIRRORAI_HOME, "data"), { recursive: true });
      mkdirSync(join(MIRRORAI_HOME, "logs"), { recursive: true });
      mkdirSync(join(MIRRORAI_HOME, "sessions"), { recursive: true });
      console.log(`✓ Created MirrorAI home: ${MIRRORAI_HOME}`);
    }

    // Copy .env template if not exists
    const envTemplate = join(process.cwd(), "config", ".env.template");
    if (!existsSync(ENV_FILE) && existsSync(envTemplate)) {
      copyFileSync(envTemplate, ENV_FILE);
      console.log(`✓ Created .env from template`);
    }

    if (options.nonInteractive) {
      // Non-interactive: use defaults
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: {
          telegram: { enabled: false, configured: false },
          zalo: { enabled: false, configured: false },
        },
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

    // Interactive mode — use inquirer
    try {
      const inquirer = await import("inquirer");

      // Step 1: Choose platforms
      const { platforms } = await inquirer.default.prompt([
        {
          type: "checkbox",
          name: "platforms",
          message: "Which platforms do you want to connect?",
          choices: [
            { name: "Telegram", value: "telegram", checked: true },
            { name: "Zalo", value: "zalo" },
          ],
        },
      ]);

      const platformConfig: Record<string, { enabled: boolean; configured: boolean }> = {};
      const envLines: string[] = [];

      // Step 2: Configure each platform
      for (const platform of platforms as string[]) {
        if (platform === "telegram") {
          const answers = await inquirer.default.prompt([
            {
              type: "input",
              name: "botToken",
              message: "Telegram Bot Token (from @BotFather):",
              validate: (input: string) =>
                input.length > 10 ? true : "Token looks too short",
            },
            {
              type: "input",
              name: "exportPath",
              message: "Path to Telegram JSON export (or press Enter to skip):",
              default: "",
            },
          ]);

          envLines.push(`TELEGRAM_BOT_TOKEN=${answers.botToken}`);
          if (answers.exportPath) {
            envLines.push(`TELEGRAM_EXPORT_PATH=${answers.exportPath}`);
          }
          platformConfig.telegram = { enabled: true, configured: true };
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
              {
                type: "input",
                name: "botToken",
                message: "Zalo Bot Token:",
              },
            ]);
            envLines.push(`ZALO_BOT_TOKEN=${botToken}`);
          } else {
            console.log("  ℹ Zalo Personal: QR login will be prompted when you run `mirrorai ingest`");
          }
          platformConfig.zalo = { enabled: true, configured: true };
          console.log("  ✓ Zalo configured");
        }
      }

      // Step 3: Choose model
      const { model } = await inquirer.default.prompt([
        {
          type: "list",
          name: "model",
          message: "Choose AI model:",
          choices: [
            { name: "Ollama — qwen2.5:14b (Local, recommended)", value: "ollama/qwen2.5:14b" },
            { name: "Ollama — qwen2.5:7b (Local, lighter)", value: "ollama/qwen2.5:7b" },
            { name: "Ollama — llama3.3:8b (Local)", value: "ollama/llama3.3:8b" },
            { name: "Claude Sonnet (Cloud, needs API key)", value: "anthropic/claude-sonnet-4-6" },
            { name: "GPT-4o (Cloud, needs API key)", value: "openai/gpt-4o" },
          ],
        },
      ]);

      // Cloud model → ask for API key
      if (model.startsWith("anthropic/")) {
        const { apiKey } = await inquirer.default.prompt([
          { type: "password", name: "apiKey", message: "Anthropic API Key:" },
        ]);
        envLines.push(`ANTHROPIC_API_KEY=${apiKey}`);
      } else if (model.startsWith("openai/")) {
        const { apiKey } = await inquirer.default.prompt([
          { type: "password", name: "apiKey", message: "OpenAI API Key:" },
        ]);
        envLines.push(`OPENAI_API_KEY=${apiKey}`);
      }

      // Save .env
      if (envLines.length > 0) {
        let envContent = "";
        if (existsSync(ENV_FILE)) {
          envContent = readFileSync(ENV_FILE, "utf-8") + "\n";
        }
        envContent += envLines.join("\n") + "\n";
        writeFileSync(ENV_FILE, envContent);
      }

      // Save state
      const state: InitState = {
        state: "CONFIGURING_PLATFORM",
        platforms: platformConfig,
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

      console.log("\n════════════════════════════════════════");
      console.log(" ✓ MirrorAI configured!");
      console.log(` Platforms: ${platforms.join(", ")}`);
      console.log(` Model: ${model}`);
      console.log(` Config: ${MIRRORAI_HOME}`);
      console.log("\n Next step: mirrorai ingest");
      console.log("════════════════════════════════════════\n");
    } catch (err) {
      // Fallback if inquirer not installed
      console.log("Interactive mode requires: npm install inquirer");
      console.log("Run with --non-interactive for default setup");
      console.error(err);
    }
  });
