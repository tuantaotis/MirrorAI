# MirrorAI Plugin Development Guide

This guide explains how to contribute new platform support to MirrorAI as an OpenClaw skill.

## Architecture Overview

MirrorAI uses a skill-based plugin architecture built on OpenClaw:

```
packages/openclaw-plugin/
  openclaw.plugin.json          # Plugin manifest
  skills/
    mirror-respond.ts           # Core: RAG response generation
    data-ingest.ts              # Core: bulk data pipeline
    persona-update.ts           # Core: periodic persona refresh
    persona-status.ts           # Core: diagnostics
    export-telegram.ts          # Platform: Telegram
    export-zalo.ts              # Platform: Zalo
    export-facebook.ts          # Platform: Facebook Messenger
    export-instagram.ts         # Platform: Instagram DMs
    export-discord.ts           # Platform: Discord
    export-whatsapp.ts          # Platform: WhatsApp
```

## Adding a New Platform

### 1. Create the skill file

```bash
# Create: packages/openclaw-plugin/skills/export-<your-platform>.ts
```

### 2. Implement the required interface

Every export skill must export:

#### `metadata` (required)

```typescript
export const metadata = {
  id: "signal",                      // Unique platform ID (lowercase)
  displayName: "Signal",             // Human-readable name
  icon: "📶",                       // Emoji for the wizard UI
  status: "manual",                  // "ready" = auto-export, "manual" = user exports, "coming_soon"
  hasAutoExport: false,              // true if you implement autoExport()
  hasBotReply: false,                // true if bot can reply on this platform
  manualExportGuide: [               // Steps shown when user needs to export manually
    "1. Open Signal Desktop",
    "2. File → Export messages as JSON",
    "3. Note the output file path",
  ],
  envKeys: ["SIGNAL_EXPORT_PATH"],   // Environment variables this platform uses
};
```

#### `detect(env, home)` (required)

Detect existing configuration and data:

```typescript
export function detect(env: Record<string, string>, home: string) {
  const exportPath = env.SIGNAL_EXPORT_PATH || "";
  return {
    hasSession: false,           // Is user logged in?
    hasExportData: false,        // Does export data exist?
    exportMsgCount: 0,           // Number of exported messages
    exportChats: 0,              // Number of chats
    hasBotToken: false,          // Is bot token configured?
    botTokenMasked: "",          // Masked token for display
    hasExportPath: !!exportPath && existsSync(exportPath),
    exportPath,
    selfName: "",
  };
}
```

#### `setup(inquirer, ctx)` (required)

Interactive setup prompts for the init wizard:

```typescript
export async function setup(inquirer: any, ctx: {
  env: Record<string, string>;
  envUpdates: Record<string, string>;
  detected: ReturnType<typeof detect>;
}) {
  // Ask user questions, update ctx.envUpdates
  // Return platform state
  return {
    enabled: true,
    configured: true,
    dataSource: "file" as const,    // "auto" | "file" | "pending"
    filePath: "/path/to/export",
  };
}
```

#### `autoExport(env, projectRoot)` (optional)

Only needed if `status: "ready"` and `hasAutoExport: true`:

```typescript
export async function autoExport(
  env: Record<string, string>,
  projectRoot: string
): Promise<boolean> {
  // Download chat history automatically
  // Return true on success
  return false;
}
```

### 3. Register in plugin manifest

Add your skill to `openclaw.plugin.json`:

```json
{
  "skills": [
    "skills/export-signal.ts"
  ],
  "platforms": {
    "signal": { "skill": "export-signal", "status": "manual" }
  }
}
```

### 4. Test

```bash
npm run build
mirrorai init              # Your platform appears in the wizard
mirrorai doctor            # Checks your envKeys
mirrorai ingest --platform=signal --file=<path>
```

## How Auto-Discovery Works

The `mirrorai init` command scans `packages/openclaw-plugin/skills/export-*.ts` at runtime:

1. Finds all files matching `export-*.ts`
2. Imports each file and reads its `metadata`
3. Builds the platform selection list dynamically
4. Calls `detect()` to show existing config
5. Calls `setup()` for interactive configuration
6. Calls `autoExport()` if available and user chooses auto-export

**No changes to init.ts, ingest.ts, or doctor.ts are needed when adding a new platform.**

## Data Flow

```
Export Skill (export-*.ts)     →  Export data (JSON/txt)
                                       ↓
Data Pipeline (Python)         →  normalize → clean → chunk
                                       ↓
RAG Engine (Python)            →  embed → index to ChromaDB
                                       ↓
Persona Builder (Python)       →  analyze → SOUL.md
                                       ↓
Mirror Respond (mirror-respond.ts)  →  incoming message → RAG query → auto-reply
```

## Tips

- Keep your export skill self-contained (~50-100 lines)
- Follow the existing pattern from `export-discord.ts` for manual platforms
- Follow `export-telegram.ts` for platforms with auto-export
- Test the full flow: init → ingest → mirror
