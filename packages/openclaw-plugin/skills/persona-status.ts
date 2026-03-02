/**
 * MirrorAI — persona-status Skill.
 * Diagnostic: show current persona stats, vector count, confidence distribution.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");

export async function showPersonaStatus(): Promise<string> {
  const lines: string[] = [];
  lines.push("╔════════════════════════════════════════╗");
  lines.push("║       MirrorAI Persona Status          ║");
  lines.push("╚════════════════════════════════════════╝");

  // State
  const stateFile = join(MIRRORAI_HOME, "state.json");
  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    lines.push(`\n  State: ${state.state}`);
    lines.push(`  Model: ${state.model}`);
    lines.push(`  Updated: ${state.updatedAt}`);
  } else {
    lines.push("\n  State: NOT INITIALIZED");
  }

  // Persona profile
  const profileFile = join(MIRRORAI_HOME, "persona_profile.json");
  if (existsSync(profileFile)) {
    const profile = JSON.parse(readFileSync(profileFile, "utf-8"));
    lines.push("\n  Persona Profile:");
    lines.push(`    Name: ${profile.name || "Unknown"}`);
    lines.push(`    Total messages: ${profile.total_messages || 0}`);
    lines.push(`    Writing style: ${profile.writing_style?.message_length_category || "N/A"}`);
    lines.push(`    Avg words/msg: ${profile.writing_style?.avg_word_count || 0}`);
    lines.push(`    Tone: ${profile.tone?.formality || "N/A"}`);
    lines.push(`    Emoji usage: ${profile.tone?.emoji_usage || "N/A"}`);
    lines.push(`    Top emojis: ${(profile.tone?.top_emojis || []).join(" ") || "none"}`);

    if (profile.topics?.length) {
      lines.push(`    Topics: ${profile.topics.slice(0, 8).join(", ")}`);
    }

    if (profile.platforms) {
      lines.push("    Platforms:");
      for (const [p, count] of Object.entries(profile.platforms)) {
        lines.push(`      ${p}: ${count} messages`);
      }
    }
  } else {
    lines.push("\n  Persona: Not built yet. Run: mirrorai ingest");
  }

  // Review queue
  const queueFile = join(MIRRORAI_HOME, "review_queue.jsonl");
  if (existsSync(queueFile)) {
    const queueLines = readFileSync(queueFile, "utf-8").trim().split("\n").filter(Boolean);
    lines.push(`\n  Review Queue: ${queueLines.length} pending messages`);
  }

  // SOUL.md existence
  if (existsSync("workspace/SOUL.md")) {
    const soulSize = readFileSync("workspace/SOUL.md", "utf-8").length;
    lines.push(`\n  SOUL.md: ${soulSize} chars`);
  }

  const output = lines.join("\n");
  console.log(output);
  return output;
}

export default {
  name: "persona-status",
  description: "Show persona diagnostics and stats",
  handler: showPersonaStatus,
};
