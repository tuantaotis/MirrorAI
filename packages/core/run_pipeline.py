#!/usr/bin/env python3
"""
MirrorAI Pipeline Orchestrator
Runs: normalize → clean → chunk → embed/index → persona analyze → SOUL.md

Usage:
    python -m packages.core.run_pipeline \
        --export-path ~/Downloads/result.json \
        --self-id "Your Name" \
        --data-dir ~/.mirrorai
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("mirrorai.pipeline")


def run_pipeline(export_path: str, self_id: str, data_dir: str, platform: str = "telegram") -> dict:
    """Run the full MirrorAI data pipeline."""

    start_time = time.time()
    data_path = Path(data_dir) / "data"
    data_path.mkdir(parents=True, exist_ok=True)

    log_file = Path(data_dir) / "logs" / "pipeline.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(str(log_file), mode="a")
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(file_handler)

    stats = {"platform": platform, "export_path": export_path, "steps": {}}

    # ── Step 1: Normalize ──
    logger.info("Step 1/6: Normalizing messages...")
    step_start = time.time()

    from packages.core.data_pipeline.normalizer import (
        normalize_telegram_export,
        save_messages_to_jsonl,
    )

    messages = normalize_telegram_export(export_path, self_id)
    normalized_path = str(data_path / "normalized.jsonl")
    save_messages_to_jsonl(messages, normalized_path)

    stats["steps"]["normalize"] = {
        "messages": len(messages),
        "duration_s": round(time.time() - step_start, 2),
        "output": normalized_path,
    }
    logger.info(f"  → {len(messages)} messages normalized ({stats['steps']['normalize']['duration_s']}s)")

    # ── Step 2: Clean ──
    logger.info("Step 2/6: Cleaning & filtering...")
    step_start = time.time()

    from packages.core.data_pipeline.cleaner import clean_messages

    cleaned = clean_messages(messages, min_words=3, self_id=self_id)
    cleaned_path = str(data_path / "cleaned.jsonl")
    save_messages_to_jsonl(cleaned, cleaned_path)

    stats["steps"]["clean"] = {
        "before": len(messages),
        "after": len(cleaned),
        "removed": len(messages) - len(cleaned),
        "duration_s": round(time.time() - step_start, 2),
    }
    logger.info(f"  → {len(cleaned)} messages after cleaning (removed {stats['steps']['clean']['removed']})")

    # ── Step 3: Chunk ──
    logger.info("Step 3/6: Chunking messages...")
    step_start = time.time()

    from packages.core.data_pipeline.chunker import chunk_messages

    chunks = chunk_messages(cleaned, chunk_size=512, chunk_overlap=50)

    stats["steps"]["chunk"] = {
        "chunks": len(chunks),
        "duration_s": round(time.time() - step_start, 2),
    }
    logger.info(f"  → {len(chunks)} chunks created ({stats['steps']['chunk']['duration_s']}s)")

    # ── Step 4: Embed & Index ──
    logger.info("Step 4/6: Embedding & indexing to ChromaDB...")
    step_start = time.time()

    from packages.core.rag_engine.embedder import create_embedder
    from packages.core.rag_engine.indexer import VectorIndexer

    embedder = create_embedder(
        provider=os.environ.get("EMBEDDING_PROVIDER", "ollama"),
        model=os.environ.get("EMBEDDING_MODEL", None),
    )

    indexer = VectorIndexer(
        collection_name="user_messages",
        chromadb_url=os.environ.get("CHROMADB_URL", "http://localhost:8000"),
        embedder=embedder,
    )

    indexed_count = indexer.index_chunks(chunks, batch_size=100)

    stats["steps"]["index"] = {
        "indexed": indexed_count,
        "total_in_db": indexer.count(),
        "duration_s": round(time.time() - step_start, 2),
    }
    logger.info(f"  → {indexed_count} chunks indexed ({stats['steps']['index']['duration_s']}s)")

    # ── Step 5: Persona Analysis ──
    logger.info("Step 5/6: Analyzing persona...")
    step_start = time.time()

    from packages.core.persona_builder.analyzer import PersonaAnalyzer

    analyzer = PersonaAnalyzer()
    profile = analyzer.analyze(cleaned, user_name=self_id)

    persona_path = str(data_path / "persona.json")
    profile.save(persona_path)

    stats["steps"]["persona"] = {
        "topics": len(profile.topics) if hasattr(profile, "topics") else 0,
        "duration_s": round(time.time() - step_start, 2),
        "output": persona_path,
    }
    logger.info(f"  → Persona profile saved ({stats['steps']['persona']['duration_s']}s)")

    # ── Step 6: Generate SOUL.md ──
    logger.info("Step 6/6: Generating SOUL.md...")
    step_start = time.time()

    from packages.core.persona_builder.soul_generator import save_soul_md

    soul_path = str(data_path / "SOUL.md")
    soul_content = save_soul_md(profile, soul_path)

    stats["steps"]["soul"] = {
        "path": soul_path,
        "length": len(soul_content),
        "duration_s": round(time.time() - step_start, 2),
    }
    logger.info(f"  → SOUL.md generated ({stats['steps']['soul']['duration_s']}s)")

    # ── Summary ──
    total_time = round(time.time() - start_time, 2)
    stats["total_duration_s"] = total_time
    stats["status"] = "success"

    stats_path = str(data_path / "pipeline_stats.json")
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    logger.info(f"\n{'='*50}")
    logger.info(f"Pipeline complete in {total_time}s")
    logger.info(f"  Messages: {len(messages)} → {len(cleaned)} cleaned → {len(chunks)} chunks")
    logger.info(f"  Indexed: {indexed_count} vectors in ChromaDB")
    logger.info(f"  Persona: {persona_path}")
    logger.info(f"  SOUL.md: {soul_path}")
    logger.info(f"  Stats: {stats_path}")
    logger.info(f"{'='*50}")

    # Print JSON stats to stdout for CLI to parse
    print(f"\n__PIPELINE_STATS__{json.dumps(stats)}")

    return stats


def main():
    parser = argparse.ArgumentParser(description="MirrorAI Pipeline Orchestrator")
    parser.add_argument("--export-path", required=True, help="Path to chat export file (JSON)")
    parser.add_argument("--self-id", required=True, help="Your name/ID in the chat")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/.mirrorai"), help="MirrorAI data directory")
    parser.add_argument("--platform", default="telegram", help="Platform (telegram, zalo, etc.)")

    args = parser.parse_args()

    if not os.path.exists(args.export_path):
        logger.error(f"Export file not found: {args.export_path}")
        sys.exit(1)

    try:
        stats = run_pipeline(
            export_path=args.export_path,
            self_id=args.self_id,
            data_dir=args.data_dir,
            platform=args.platform,
        )
        sys.exit(0 if stats["status"] == "success" else 1)
    except Exception as e:
        logger.error(f"Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
