/**
 * MirrorAI CLI — `mirrorai status`
 * Show current system state, platform status, and persona stats.
 */

import { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");

export const statusCommand = new Command("status")
  .description("Show current MirrorAI status — state, platforms, persona, stats")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    if (!existsSync(STATE_FILE)) {
      console.log("\n✗ MirrorAI not initialized. Run: mirrorai init\n");
      process.exit(1);
    }

    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));

    if (options.json) {
      console.log(JSON.stringify(state, null, 2));
      return;
    }

    console.log("\n╔════════════════════════════════════════╗");
    console.log("║         MirrorAI Status                ║");
    console.log("╚════════════════════════════════════════╝\n");

    // State
    const stateEmoji: Record<string, string> = {
      UNINITIALIZED: "[ ]",
      CONFIGURING_PLATFORM: "[~]",
      COLLECTING_DATA: "[~]",
      PROCESSING_DATA: "[~]",
      BUILDING_PERSONA: "[~]",
      INDEXING_VECTORS: "[~]",
      READY: "[*]",
      MIRRORING_ACTIVE: "[>]",
      PAUSED: "[||]",
      UPDATING_PERSONA: "[~]",
      ERROR: "[!]",
    };

    console.log(`  State: ${stateEmoji[state.state] ?? "[?]"} ${state.state}`);
    console.log(`  Model: ${state.model}`);
    console.log(`  Updated: ${state.updatedAt}`);

    // Platforms
    console.log("\n  Platforms:");
    for (const [name, conf] of Object.entries(state.platforms ?? {})) {
      const c = conf as { enabled: boolean; configured: boolean };
      const status = c.enabled
        ? c.configured
          ? "connected"
          : "enabled (not configured)"
        : "disabled";
      console.log(`    ${name}: ${status}`);
    }

    // Persona stats (if available)
    const personaFile = join(MIRRORAI_HOME, "persona_profile.json");
    if (existsSync(personaFile)) {
      try {
        const persona = JSON.parse(readFileSync(personaFile, "utf-8"));
        console.log("\n  Persona:");
        console.log(`    Topics: ${persona.topics?.slice(0, 5).join(", ") ?? "N/A"}`);
        console.log(`    Avg msg length: ${persona.avg_word_count ?? "N/A"} words`);
        console.log(`    Tone: ${persona.tone ?? "N/A"}`);
        console.log(`    Messages indexed: ${persona.total_messages ?? "N/A"}`);
      } catch {
        // persona file corrupt — skip
      }
    }

    // Queue
    const queueFile = join(MIRRORAI_HOME, "review_queue.jsonl");
    if (existsSync(queueFile)) {
      const lines = readFileSync(queueFile, "utf-8").trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        console.log(`\n  Review Queue: ${lines.length} pending messages`);
      }
    }

    console.log("");
  });
