/**
 * MirrorAI CLI — `mirrorai mirror`
 * Enable, pause, or resume the AI mirror (auto-reply as persona).
 * Uses grammY to run a Telegram bot + Python RAG for responses.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const LOG_FILE = join(MIRRORAI_HOME, "logs", "mirror.log");

function loadState(): any {
  if (!existsSync(STATE_FILE)) {
    console.error("✗ Not initialized. Run: mirrorai init");
    process.exit(1);
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}

function saveState(state: any): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

function findProjectRoot(): string {
  const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const candidates = [
    resolve(cliDir, ".."),
    resolve(cliDir, "..", ".."),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "core", "rag_engine", "query.py"))) {
      return c;
    }
  }
  return candidates[0];
}

function appendLog(msg: string): void {
  const { mkdirSync, appendFileSync } = require("node:fs");
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* best effort */ }
}

/** Query the Python RAG engine for a response */
function queryRAG(message: string, sender: string, projectRoot: string, env: Record<string, string>): { reply: string; confidence: number } | null {
  const soulPath = join(MIRRORAI_HOME, "data", "SOUL.md");
  if (!existsSync(soulPath)) {
    console.warn("[Mirror] SOUL.md not found. Run: mirrorai ingest");
    return null;
  }

  // Use Python RAG query engine
  const script = `
import json, sys, os
sys.path.insert(0, os.getcwd())
from packages.core.rag_engine.retriever import SemanticRetriever
from packages.core.rag_engine.query import RAGQueryEngine
from packages.core.rag_engine.embedder import create_embedder

embedder = create_embedder(
    provider=os.environ.get("EMBEDDING_PROVIDER", "ollama"),
    model=os.environ.get("EMBEDDING_MODEL", None)
)

retriever = SemanticRetriever(
    collection_name="user_messages",
    chromadb_url=os.environ.get("CHROMADB_URL", "http://localhost:8000"),
    embedder=embedder
)

engine = RAGQueryEngine(
    retriever=retriever,
    soul_md_path="${soulPath.replace(/\\/g, "/")}",
    confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.6")),
    model=os.environ.get("LLM_MODEL", "qwen2.5:14b"),
    temperature=float(os.environ.get("LLM_TEMPERATURE", "0.7"))
)

result = engine.query(
    message="""${message.replace(/"/g, '\\"').replace(/\n/g, "\\n")}""",
    sender="${sender.replace(/"/g, '\\"')}",
    history=[]
)

print("__RAG_RESULT__" + json.dumps({
    "reply": result.response,
    "confidence": result.confidence
}))
`;

  try {
    const output = execSync(`python3 -c ${JSON.stringify(script)}`, {
      cwd: projectRoot,
      env: { ...process.env, ...env, PYTHONPATH: projectRoot },
      timeout: 30_000,
      encoding: "utf-8",
    });

    for (const line of output.split("\n")) {
      if (line.startsWith("__RAG_RESULT__")) {
        return JSON.parse(line.replace("__RAG_RESULT__", ""));
      }
    }
  } catch (err: any) {
    console.error(`[Mirror] RAG query failed: ${err.message}`);
    appendLog(`RAG_ERROR: ${err.message}`);
  }

  return null;
}

export const mirrorCommand = new Command("mirror")
  .description("Control the AI mirror — auto-reply on your behalf")
  .option("--enable", "Enable mirroring (start auto-reply)")
  .option("--pause", "Pause mirroring (stop auto-reply, keep data flowing)")
  .option("--resume", "Resume mirroring after pause")
  .option("--disable", "Completely disable mirroring")
  .action(async (options) => {
    const state = loadState();

    if (options.enable) {
      if (state.state !== "READY" && state.state !== "PAUSED") {
        console.error(
          `✗ Cannot enable mirror in state: ${state.state}\n` +
            `  Required: READY or PAUSED\n` +
            `  Run: mirrorai ingest (to prepare data first)`
        );
        process.exit(1);
      }

      const env = loadEnv();
      const botToken = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        console.error("✗ TELEGRAM_BOT_TOKEN not found in ~/.mirrorai/.env");
        console.error("  Run: mirrorai init");
        process.exit(1);
      }

      // Check SOUL.md exists
      const soulPath = join(MIRRORAI_HOME, "data", "SOUL.md");
      if (!existsSync(soulPath)) {
        console.error("✗ SOUL.md not found. Run: mirrorai ingest");
        process.exit(1);
      }

      state.state = "MIRRORING_ACTIVE";
      saveState(state);

      console.log("\n╔════════════════════════════════════════╗");
      console.log("║     MirrorAI — Mirroring ACTIVE        ║");
      console.log("╚════════════════════════════════════════╝\n");

      const projectRoot = findProjectRoot();
      const confidenceThreshold = parseFloat(env.CONFIDENCE_THRESHOLD || "0.6");

      // Start grammY bot
      try {
        const { Bot } = await import("grammy");
        const bot = new Bot(botToken);

        // Get bot info
        const me = await bot.api.getMe();
        console.log(`  Bot: @${me.username} (${me.first_name})`);
        console.log(`  Model: ${state.model}`);
        console.log(`  Confidence threshold: ${confidenceThreshold}`);
        console.log(`  SOUL: ${soulPath}`);
        console.log(`  Log: ${LOG_FILE}`);
        console.log("\n  Listening for messages... (Ctrl+C to stop)\n");

        appendLog(`BOT_START: @${me.username}`);

        bot.on("message:text", async (ctx) => {
          const sender = ctx.from?.first_name || ctx.from?.username || "Unknown";
          const chatId = String(ctx.chat.id);
          const text = ctx.message.text;

          console.log(`[${new Date().toISOString()}] ${sender}: ${text.slice(0, 80)}`);
          appendLog(`MSG_IN: chat=${chatId} sender=${sender} text=${text.slice(0, 100)}`);

          // Send typing indicator
          await ctx.api.sendChatAction(chatId, "typing").catch(() => {});

          // Query RAG engine
          const result = queryRAG(text, sender, projectRoot, env);

          if (result && result.confidence >= confidenceThreshold) {
            // Simulate human typing delay (50-100ms per char, capped at 5s)
            const delay = Math.min(result.reply.length * 70, 5000);
            await new Promise((r) => setTimeout(r, delay));

            // Send reply
            await ctx.reply(result.reply);
            console.log(`  → [${result.confidence.toFixed(2)}] ${result.reply.slice(0, 80)}`);
            appendLog(`MSG_OUT: chat=${chatId} conf=${result.confidence.toFixed(2)} text=${result.reply.slice(0, 100)}`);
          } else {
            const reason = result
              ? `confidence too low (${result.confidence.toFixed(2)} < ${confidenceThreshold})`
              : "RAG query failed";
            console.log(`  → [SKIP] ${reason}`);
            appendLog(`MSG_SKIP: chat=${chatId} reason=${reason}`);
          }
        });

        // Graceful shutdown
        const shutdown = () => {
          console.log("\n[Mirror] Stopping bot...");
          appendLog("BOT_STOP");
          bot.stop();
          state.state = "READY";
          saveState(state);
          console.log("[Mirror] Bot stopped. State → READY\n");
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        // Start polling
        await bot.start({
          onStart: () => {
            console.log("[Mirror] Bot is online and polling for messages.\n");
          },
        });
      } catch (err: any) {
        console.error(`\n✗ Failed to start bot: ${err.message}`);
        if (err.message.includes("grammy")) {
          console.error("  Install grammY: cd apps/cli && npm install grammy");
        }
        state.state = "READY";
        saveState(state);
        process.exit(1);
      }
    }

    if (options.pause) {
      if (state.state !== "MIRRORING_ACTIVE") {
        console.error(`✗ Not currently mirroring. State: ${state.state}`);
        process.exit(1);
      }
      state.state = "PAUSED";
      saveState(state);
      console.log("\n[Mirror] Paused. Auto-reply is OFF.");
      console.log("  Resume: mirrorai mirror --resume\n");
    }

    if (options.resume) {
      if (state.state !== "PAUSED") {
        console.error(`✗ Not paused. State: ${state.state}`);
        process.exit(1);
      }
      // Resume = re-enable
      state.state = "READY";
      saveState(state);
      console.log("\n[Mirror] State reset to READY.");
      console.log("  Run: mirrorai mirror --enable (to start bot again)\n");
    }

    if (options.disable) {
      state.state = "READY";
      saveState(state);
      console.log("\n[Mirror] Disabled. Use --enable to restart.\n");
    }

    // No flag → show current status
    if (!options.enable && !options.pause && !options.resume && !options.disable) {
      const isActive = state.state === "MIRRORING_ACTIVE";
      const isPaused = state.state === "PAUSED";
      console.log(`\n  Mirror: ${isActive ? "ACTIVE" : isPaused ? "PAUSED" : "OFF"}`);
      console.log(`  State: ${state.state}`);
      console.log(`  Model: ${state.model}`);
      console.log(`  Log: ${LOG_FILE}\n`);
    }
  });
