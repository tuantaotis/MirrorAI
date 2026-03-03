# MirrorAI

**Create an AI clone of yourself from your chat data.** Runs 100% local on your machine, powered by [OpenClaw](https://openclaw.ai/).

MirrorAI collects your chat history from Telegram, Zalo (and more), analyzes your writing style, and creates an AI persona that can respond on your behalf — matching your tone, vocabulary, and habits.

```
You ──→ Chat Data ──→ Persona Builder ──→ AI Clone ──→ Responds as You
        (TG/Zalo)     (RAG + Analysis)    (OpenClaw)    (Auto or Manual)
```

## Features

- **100% Local** — All data stays on your machine. No cloud uploads.
- **Multi-platform** — Telegram, Zalo built-in. Extensible to any chat platform.
- **Smart Persona** — Analyzes writing style, vocabulary, tone, emoji habits, topics.
- **RAG-powered** — Retrieves similar past messages for context-aware responses.
- **Confidence scoring** — Auto-replies when confident, queues for review when unsure.
- **Human-like timing** — Simulates natural typing speed (35-65 WPM).
- **Switchable AI** — Ollama (local), Claude, GPT, Gemini — change via config, zero code change.
- **OpenClaw native** — Integrates as an OpenClaw plugin with skills system.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Your Machine (Local)                 │
│                                                      │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Connectors │→ │ Pipeline │→ │ Persona Builder  │  │
│  │ TG / Zalo  │  │ ETL      │  │ → SOUL.md        │  │
│  └────────────┘  └──────────┘  └──────────────────┘  │
│        ↕               ↓              ↓              │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  OpenClaw  │← │ ChromaDB │← │ RAG Engine       │  │
│  │  Gateway   │  │ (Vector) │  │ query + generate │  │
│  └────────────┘  └──────────┘  └──────────────────┘  │
│        ↕                              ↑              │
│  ┌────────────┐              ┌──────────────────┐    │
│  │ Channels   │              │ Ollama (LLM)     │    │
│  │ TG/Zalo/Web│              │ qwen2.5 + embed  │    │
│  └────────────┘              └──────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Quick Start

### One-command install (macOS)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/user/mirrorai/main/scripts/install.sh)"
```

### Manual install

```bash
# 1. Prerequisites
brew install node@20 python@3.12 ollama
brew install --cask docker

# 2. AI Models
ollama pull qwen2.5:14b        # Chat model (~9GB)
ollama pull nomic-embed-text   # Embedding model (~270MB)

# 3. ChromaDB
docker run -d --name chromadb -p 8000:8000 chromadb/chroma:latest

# 4. Clone & install
git clone https://github.com/user/mirrorai.git
cd mirrorai
npm install --workspaces
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

# 5. Setup
mirrorai init       # Interactive wizard
mirrorai ingest     # Import your chat data
mirrorai status     # Check everything is ready
mirrorai mirror --enable  # Start your AI clone
```

## Usage

### Step 1: Initialize

```bash
mirrorai init
```

Interactive wizard that configures:
- Which platforms to connect (Telegram, Zalo)
- Authentication (bot token, QR login)
- AI model selection (local Ollama or cloud)

### Step 2: Import chat data

**Telegram:**
1. Open Telegram Desktop → Settings → Advanced → Export Telegram Data
2. Select JSON format, check "Personal chats" and "Group chats"
3. Run:
```bash
mirrorai ingest --platform=telegram --file=~/Downloads/result.json
```

**Zalo:**
```bash
mirrorai ingest --platform=zalo
# Follows QR login flow, then fetches history automatically
```

### Step 3: Enable mirroring

```bash
mirrorai mirror --enable    # Start auto-reply
mirrorai mirror --pause     # Pause (data still flows)
mirrorai mirror --resume    # Resume
mirrorai mirror --disable   # Stop completely
```

### Step 4: Monitor

```bash
mirrorai status   # State, platforms, persona stats, queue size
```

## State Machine

```
UNINITIALIZED → INSTALLING_DEPS → CONFIGURING_PLATFORM → COLLECTING_DATA
→ PROCESSING_DATA → BUILDING_PERSONA → INDEXING_VECTORS → READY
→ MIRRORING_ACTIVE ⇄ PAUSED
         ↓
  UPDATING_PERSONA (every 30 min)
```

## Configuration

All config in `config/mirrorai.config.yaml`:

```yaml
model:
  primary: "ollama/qwen2.5:14b"         # Local AI
  fallback: "anthropic/claude-sonnet-4-6" # Cloud backup

embedding:
  provider: "ollama"                      # "ollama" or "openai"
  model: "nomic-embed-text"

persona:
  confidence_threshold: 0.65  # Auto-reply threshold (0.0-1.0)
  auto_reply: true
  manual_review_queue: true
```

### Switching AI providers

Zero code change — just edit config:

```yaml
# Local (free, private)
model:
  primary: "ollama/qwen2.5:14b"

# Cloud (higher quality)
model:
  primary: "anthropic/claude-sonnet-4-6"

# Hybrid (local first, cloud fallback)
model:
  primary: "ollama/qwen2.5:14b"
  fallback: "anthropic/claude-sonnet-4-6"
```

Environment variables in `~/.mirrorai/.env`:

```bash
TELEGRAM_BOT_TOKEN=123:abc
ANTHROPIC_API_KEY=sk-...     # Optional: for cloud fallback
OLLAMA_URL=http://localhost:11434
CHROMADB_URL=http://localhost:8000
```

## Adding a new platform

MirrorAI uses an extensible connector pattern. To add a new platform:

```typescript
// 1. Create packages/connectors/discord/index.ts
import { SocialConnector } from "../base/connector.js";
import { ConnectorRegistry } from "../base/registry.js";

export class DiscordConnector extends SocialConnector {
  readonly platform = "discord";
  readonly displayName = "Discord";
  // Implement abstract methods...
}

// 2. Register (one line)
ConnectorRegistry.register("discord", () => new DiscordConnector());

// 3. Add "discord" to mirrorai.config.yaml — done!
```

No changes needed in pipeline, persona builder, or RAG engine.

## Project Structure

```
mirrorai/
├── packages/
│   ├── connectors/          # Platform connectors (Telegram, Zalo)
│   │   ├── base/            # Abstract SocialConnector + Registry
│   │   ├── telegram/        # Telegram export parser + realtime
│   │   └── zalo/            # Zalo history fetcher + realtime
│   ├── core/                # Python: data pipeline + AI engine
│   │   ├── data_pipeline/   # Normalize → Clean → Chunk
│   │   ├── rag_engine/      # Embed → Index → Retrieve → Query
│   │   └── persona_builder/ # Analyze → Generate SOUL.md
│   └── openclaw-plugin/     # OpenClaw skills + manifest
│       └── skills/          # mirror-respond, persona-update, etc.
├── apps/cli/                # CLI: mirrorai init/ingest/status/mirror
├── scripts/install.sh       # One-command macOS installer
├── config/                  # YAML config + .env template
└── workspace/               # OpenClaw workspace (AGENTS.md, SOUL.md)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Core Platform | [OpenClaw](https://openclaw.ai/) |
| LLM (local) | Ollama — qwen2.5 |
| Embedding | nomic-embed-text |
| Vector DB | ChromaDB |
| Connectors | TypeScript (grammY, zca-js) |
| Data Pipeline | Python (LangChain, scikit-learn) |
| Vietnamese NLP | underthesea |
| CLI | Commander + Inquirer |

## How it works

1. **Collect** — Import chat history from Telegram JSON export or Zalo API
2. **Clean** — Filter system messages, media-only, too-short messages
3. **Chunk** — Group into conversation-aware 512-token chunks with overlap
4. **Embed** — Convert to vectors via nomic-embed-text (local)
5. **Index** — Store in ChromaDB for semantic search
6. **Analyze** — Extract writing style, vocabulary, tone, topics
7. **Generate SOUL.md** — Create persona definition for OpenClaw
8. **Mirror** — On incoming message: RAG retrieve → prompt assembly → LLM → confidence check → reply

## Hardware Requirements

| Setup | RAM | Model | Quality |
|-------|-----|-------|---------|
| Minimum | 8GB | qwen2.5:7b | Good for casual chat |
| Recommended | 16GB | qwen2.5:14b | Great for most use cases |
| Best | 32GB+ | qwen2.5:32b | Near cloud-quality |

Apple Silicon Macs are recommended for local inference (Metal GPU acceleration).

## License

MIT

## Contributing

PRs welcome. To add a new platform connector, see the "Adding a new platform" section above.

---

## OpenClaw Plugin

MirrorAI is built as an [OpenClaw](https://openclaw.ai/) plugin. You can install it directly from ClawHub:

```bash
# Install via OpenClaw
openclaw install mirrorai

# Or clone and use directly
git clone https://github.com/mirrorai/mirrorai.git
cd mirrorai
npm install
npm run build
```

### Plugin Architecture

Each chat platform is a self-contained skill file:

```
packages/openclaw-plugin/skills/
  export-telegram.ts     # Auto-export + bot reply
  export-zalo.ts         # Auto-export + bot reply
  export-facebook.ts     # Manual export guide
  export-instagram.ts    # Manual export guide
  export-discord.ts      # Manual export guide
  export-whatsapp.ts     # Manual export guide
```

**Adding a new platform?** Create one file, submit a PR. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### OpenClaw Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| `mirror-respond` | message | RAG-powered persona response |
| `data-ingest` | command | Bulk data pipeline |
| `persona-update` | cron (30min) | Incremental persona refresh |
| `persona-status` | command | Diagnostics & stats |
| `export-*` | command | Platform data exporters |
