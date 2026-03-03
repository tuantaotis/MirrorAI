/**
 * MirrorAI — persona-update Skill.
 * Cron skill: runs periodically to ingest new messages and rebuild persona.
 * Default interval: every 30 minutes.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const PENDING_QUEUE = join(MIRRORAI_HOME, "pending_queue.jsonl");
const LOG_FILE = join(MIRRORAI_HOME, "logs", "persona-update.log");

// ─── OpenClaw Skill Metadata ────────────────────────────────────────────────
export const skillMeta = {
  id: "persona-update",
  name: "Persona Update",
  description: "Periodically update persona from new messages",
  trigger: "cron",
  cron: "*/30 * * * *",
  channels: [],
  requires: ["chromadb", "ollama", "python3"],
  envKeys: [],
};

function log(message: string): void {
  const entry = `[${new Date().toISOString()}] ${message}`;
  console.log(entry);
  try {
    const { appendFileSync } = require("node:fs");
    appendFileSync(LOG_FILE, entry + "\n");
  } catch {
    // ignore
  }
}

/**
 * Process pending messages and update persona.
 */
export async function updatePersona(): Promise<void> {
  log("Starting persona update cycle...");

  // Check for pending messages
  if (!existsSync(PENDING_QUEUE)) {
    log("No pending messages. Skipping update.");
    return;
  }

  const pendingContent = readFileSync(PENDING_QUEUE, "utf-8").trim();
  const lines = pendingContent.split("\n").filter(Boolean);

  if (lines.length === 0) {
    log("No pending messages. Skipping update.");
    return;
  }

  log(`Processing ${lines.length} new messages...`);

  try {
    // Call Python pipeline: embed new messages + upsert to ChromaDB
    execSync(
      `python3 -c "
import json
from packages.core.data_pipeline.normalizer import UniversalMessage
from packages.core.data_pipeline.cleaner import clean_messages
from packages.core.data_pipeline.chunker import chunk_messages
from packages.core.rag_engine.indexer import VectorIndexer

# Load pending messages
messages = []
with open('${PENDING_QUEUE.replace(/\\/g, "/")}', 'r') as f:
    for line in f:
        if line.strip():
            messages.append(UniversalMessage.from_dict(json.loads(line)))

print(f'Loaded {len(messages)} pending messages')

# Clean
cleaned = clean_messages(messages, min_words=2)
print(f'After cleaning: {len(cleaned)} messages')

# Chunk
chunks = chunk_messages(cleaned, chunk_size=512, chunk_overlap=50)
print(f'Created {len(chunks)} chunks')

# Index
if chunks:
    indexer = VectorIndexer()
    indexed = indexer.index_chunks(chunks)
    print(f'Indexed {indexed} chunks to ChromaDB')
    print(f'Total vectors: {indexer.count()}')
"`,
      { encoding: "utf-8", timeout: 120000, stdio: "inherit" }
    );

    // Rebuild persona if significant changes
    if (lines.length >= 10) {
      log("Significant new data — rebuilding persona...");
      execSync(
        `python3 -c "
from packages.core.persona_builder.analyzer import PersonaAnalyzer
from packages.core.persona_builder.soul_generator import save_soul_md
from packages.core.data_pipeline.normalizer import load_messages_from_jsonl
import os

data_dir = os.path.expanduser('~/.mirrorai/data')
# Load all processed messages
messages = []
for f in os.listdir(data_dir) if os.path.isdir(data_dir) else []:
    if f.endswith('.jsonl'):
        messages.extend(load_messages_from_jsonl(os.path.join(data_dir, f)))

if messages:
    analyzer = PersonaAnalyzer()
    profile = analyzer.analyze(messages)
    save_soul_md(profile, 'workspace/SOUL.md')
    profile.save(os.path.expanduser('~/.mirrorai/persona_profile.json'))
    print(f'Persona rebuilt from {len(messages)} messages')
"`,
        { encoding: "utf-8", timeout: 120000, stdio: "inherit" }
      );
    }

    // Clear pending queue
    writeFileSync(PENDING_QUEUE, "");
    log(`Update complete. Processed ${lines.length} messages.`);
  } catch (err) {
    log(`Error during update: ${err}`);
  }
}

export default {
  ...skillMeta,
  handler: updatePersona,
};
