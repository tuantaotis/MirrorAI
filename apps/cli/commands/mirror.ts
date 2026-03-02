/**
 * MirrorAI CLI — `mirrorai mirror`
 * Enable, pause, or resume the AI mirror (auto-reply as persona).
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");

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

      state.state = "MIRRORING_ACTIVE";
      saveState(state);

      console.log("\n╔════════════════════════════════════════╗");
      console.log("║     MirrorAI — Mirroring ACTIVE        ║");
      console.log("╚════════════════════════════════════════╝\n");
      console.log("  Your AI clone is now responding on your behalf.");
      console.log("  Platforms:", Object.entries(state.platforms)
        .filter(([_, c]: [string, any]) => c.enabled)
        .map(([n]) => n)
        .join(", "));
      console.log("  Model:", state.model);
      console.log("\n  To pause: mirrorai mirror --pause");
      console.log("  To stop:  mirrorai mirror --disable\n");

      // In production: starts OpenClaw gateway with mirror-respond skill active
      console.log("[Mirror] Starting OpenClaw Gateway with mirror-respond skill...");
      console.log("[Mirror] Listening for incoming messages...\n");
    }

    if (options.pause) {
      if (state.state !== "MIRRORING_ACTIVE") {
        console.error(`✗ Not currently mirroring. State: ${state.state}`);
        process.exit(1);
      }

      state.state = "PAUSED";
      saveState(state);
      console.log("\n[Mirror] Paused. Data still flowing, but auto-reply is OFF.");
      console.log("  Resume: mirrorai mirror --resume\n");
    }

    if (options.resume) {
      if (state.state !== "PAUSED") {
        console.error(`✗ Not paused. State: ${state.state}`);
        process.exit(1);
      }

      state.state = "MIRRORING_ACTIVE";
      saveState(state);
      console.log("\n[Mirror] Resumed. Auto-reply is ON.\n");
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
      console.log(`  Model: ${state.model}\n`);
    }
  });
