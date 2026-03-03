# Contributing to MirrorAI

Thanks for your interest in contributing to MirrorAI! This guide will help you get started.

## Adding a New Platform

The easiest way to contribute is adding support for a new chat platform. Each platform is a single file:

```bash
packages/openclaw-plugin/skills/export-<platform>.ts
```

### Step-by-step

1. **Create the file**: Copy an existing export skill (e.g., `export-discord.ts`) as a template
2. **Implement the interface**:

```typescript
export const metadata = {
  id: "signal",                    // unique platform ID
  displayName: "Signal",           // shown in wizard
  icon: "📶",                     // emoji icon
  status: "manual",               // "ready" | "manual" | "coming_soon"
  hasAutoExport: false,            // can auto-download chat history?
  hasBotReply: false,              // can bot reply on this platform?
  manualExportGuide: [             // steps for manual export
    "1. Open Signal Desktop",
    "2. File → Export messages",
  ],
  envKeys: ["SIGNAL_EXPORT_PATH"], // env vars this platform uses
};

export function detect(env, home) { ... }     // detect existing config
export async function setup(inquirer, ctx) { ... }  // wizard prompts
// Optional: export async function autoExport(env, projectRoot) { ... }
```

3. **Submit a PR** — `mirrorai init` will auto-detect your new file. No other changes needed!

### Testing your skill

```bash
npm run build
mirrorai init          # your platform should appear in the wizard
mirrorai doctor        # checks envKeys from your skill metadata
```

## Development Setup

```bash
git clone https://github.com/mirrorai/mirrorai.git
cd mirrorai
npm install
npm run build
```

## Code Style

- TypeScript for CLI and OpenClaw skills
- Python for core AI engine (data pipeline, RAG, persona builder)
- Use existing patterns — look at similar files before creating new ones

## Pull Requests

- Keep PRs focused on a single change
- Include a clear description of what and why
- Test locally before submitting

## Reporting Issues

Open an issue at https://github.com/mirrorai/mirrorai/issues with:
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, Python version)
