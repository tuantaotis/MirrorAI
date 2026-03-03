# Changelog

All notable changes to MirrorAI will be documented in this file.

## [1.0.0] - 2026-03-04

### Added
- OpenClaw plugin architecture with auto-discoverable export skills
- Platform export skills: Telegram, Zalo, Facebook, Instagram, Discord, WhatsApp
- OpenClaw skill metadata for all core skills (mirror-respond, data-ingest, persona-update, persona-status)
- Dynamic platform discovery in `mirrorai init` wizard (scans `export-*.ts` files)
- `openclaw.plugin.json` with full spec: configSchema, platforms, channels, requires
- Community files: LICENSE (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md
- Plugin development guide: `docs/PLUGIN_DEVELOPMENT.md`

### Changed
- Refactored `init.ts` from 817 lines to ~250 lines using skill-based auto-discovery
- Refactored `ingest.ts` from 194 lines to ~100 lines delegating to skill handlers
- Updated `doctor.ts` to check envKeys from skill metadata dynamically

### Architecture
- Each platform = 1 self-contained `export-*.ts` file
- Adding a new platform requires only creating 1 file — no changes to init/ingest/doctor
- OpenClaw-compatible skill format with trigger, channels, requires metadata
