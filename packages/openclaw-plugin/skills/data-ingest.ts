/**
 * MirrorAI — data-ingest Skill.
 * One-time bulk historical data ingestion.
 * Triggers full pipeline: collect → clean → chunk → embed → index → build persona.
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");

// ─── OpenClaw Skill Metadata ────────────────────────────────────────────────
export const skillMeta = {
  id: "data-ingest",
  name: "Data Ingest",
  description: "Bulk historical data ingestion — normalize, clean, chunk, embed, index, build persona",
  trigger: "command",
  channels: [],
  requires: ["chromadb", "ollama", "python3"],
  envKeys: ["TELEGRAM_EXPORT_PATH", "TELEGRAM_SELF_NAME"],
};

export async function runBulkIngest(options: {
  platform?: string;
  exportFile?: string;
  selfName?: string;
}): Promise<void> {
  console.log("\n[MirrorAI] Starting bulk data ingestion...\n");

  const selfName = options.selfName || "User";
  const exportFile = options.exportFile || "";
  const dataDir = join(MIRRORAI_HOME, "data");

  try {
    execSync(
      `python3 -c "
import json, os, sys
sys.path.insert(0, '.')

from packages.core.data_pipeline.normalizer import (
    normalize_telegram_export, save_messages_to_jsonl, UniversalMessage
)
from packages.core.data_pipeline.cleaner import clean_messages
from packages.core.data_pipeline.chunker import chunk_messages
from packages.core.rag_engine.indexer import VectorIndexer
from packages.core.persona_builder.analyzer import PersonaAnalyzer
from packages.core.persona_builder.soul_generator import save_soul_md

data_dir = os.path.expanduser('${dataDir.replace(/\\/g, "/")}')
os.makedirs(data_dir, exist_ok=True)

messages = []

# Telegram export
export_file = '${exportFile.replace(/\\/g, "/")}'
if export_file and os.path.exists(export_file):
    print(f'[1/5] Parsing Telegram export: {export_file}')
    tg_msgs = normalize_telegram_export(export_file, '${selfName}')
    messages.extend(tg_msgs)
    save_messages_to_jsonl(tg_msgs, os.path.join(data_dir, 'telegram.jsonl'))
    print(f'  → {len(tg_msgs)} messages from Telegram')

if not messages:
    print('No messages found. Provide a Telegram export or configure Zalo.')
    sys.exit(0)

# Clean
print(f'[2/5] Cleaning {len(messages)} messages...')
cleaned = clean_messages(messages, min_words=3)
print(f'  → {len(cleaned)} messages after cleaning')

# Chunk
print(f'[3/5] Chunking...')
chunks = chunk_messages(cleaned, chunk_size=512, chunk_overlap=50)
print(f'  → {len(chunks)} chunks')

# Index
print(f'[4/5] Embedding & indexing to ChromaDB...')
try:
    indexer = VectorIndexer()
    indexed = indexer.index_chunks(chunks, batch_size=100)
    print(f'  → {indexed} chunks indexed, total: {indexer.count()} vectors')
except Exception as e:
    print(f'  ! ChromaDB not available: {e}')
    print(f'  ! Start ChromaDB: docker run -p 8000:8000 chromadb/chroma')

# Build persona
print(f'[5/5] Building persona...')
analyzer = PersonaAnalyzer()
profile = analyzer.analyze(cleaned, user_name='${selfName}')
profile.save(os.path.expanduser('~/.mirrorai/persona_profile.json'))
save_soul_md(profile, 'workspace/SOUL.md')
print(f'  → SOUL.md generated')
print(f'  → Topics: {profile.topics[:5]}')
print(f'  → Style: {profile.writing_style.message_length_category}')
print(f'  → Tone: {profile.tone.formality}')

print(f'\\nIngestion complete! {len(cleaned)} messages processed.')
"`,
      { encoding: "utf-8", timeout: 300000, stdio: "inherit", cwd: process.cwd() }
    );
  } catch (err) {
    console.error("[MirrorAI] Bulk ingest error:", err);
  }
}

export default {
  ...skillMeta,
  handler: runBulkIngest,
};
