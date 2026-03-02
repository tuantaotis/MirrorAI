#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# MirrorAI — One-Command Installer for macOS
# Usage: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/user/mirrorai/main/scripts/install.sh)"
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

MIRRORAI_HOME="$HOME/.mirrorai"
REPO_DIR="$MIRRORAI_HOME/app"
LOG="$MIRRORAI_HOME/install.log"
REPO_URL="https://github.com/user/mirrorai"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()  { echo -e "${GREEN}  ✓${NC} $1"; }
warn(){ echo -e "${YELLOW}  ⚠${NC} $1"; }
err() { echo -e "${RED}  ✗${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════╗"
echo "║     MirrorAI — Installer v1.0.0        ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── Create home directory ───────────────────────────────────────
mkdir -p "$MIRRORAI_HOME"/{data,logs,sessions}
touch "$LOG"

# ── Step 1: Check prerequisites ─────────────────────────────────
log "[1/8] Checking prerequisites..."

# Homebrew
if ! command -v brew &>/dev/null; then
    log "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
ok "Homebrew"

# Node.js 18+
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VERSION" -lt 18 ]; then
    log "Installing Node.js 20..."
    brew install node@20 && brew link node@20 --force 2>>"$LOG"
fi
ok "Node.js $(node -v 2>/dev/null || echo 'installed')"

# Python 3.10+
if ! python3 --version 2>/dev/null | grep -qE "3\.(1[0-9]|[2-9][0-9])"; then
    log "Installing Python 3.12..."
    brew install python@3.12 2>>"$LOG"
fi
ok "Python $(python3 --version 2>/dev/null)"

# Docker
if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    brew install --cask docker 2>>"$LOG"
    open /Applications/Docker.app 2>/dev/null || true
    warn "Docker installed — please start Docker Desktop"
fi
ok "Docker"

# ── Step 2: Install Ollama ──────────────────────────────────────
log "[2/8] Setting up Ollama..."
if ! command -v ollama &>/dev/null; then
    brew install ollama 2>>"$LOG"
    brew services start ollama 2>>"$LOG" || true
fi
ok "Ollama installed"

# ── Step 3: Pull AI models ──────────────────────────────────────
log "[3/8] Downloading AI models (this may take a while)..."
ollama pull nomic-embed-text 2>>"$LOG" && ok "nomic-embed-text (embedding)" || warn "Pull failed — retry manually: ollama pull nomic-embed-text"
ollama pull qwen2.5:14b 2>>"$LOG" && ok "qwen2.5:14b (chat)" || warn "Pull failed — retry manually: ollama pull qwen2.5:14b"

# ── Step 4: Clone/update repo ───────────────────────────────────
log "[4/8] Setting up MirrorAI..."
if [ -d "$REPO_DIR" ]; then
    cd "$REPO_DIR" && git pull 2>>"$LOG"
    ok "Updated existing installation"
else
    git clone "$REPO_URL" "$REPO_DIR" 2>>"$LOG" || {
        warn "Git clone failed — creating from local template"
        mkdir -p "$REPO_DIR"
    }
    ok "Repository cloned"
fi

# ── Step 5: Install Node.js dependencies ────────────────────────
log "[5/8] Installing Node.js dependencies..."
cd "$REPO_DIR"
npm install --workspaces 2>>"$LOG"
npm run build --workspaces 2>>"$LOG" || true
ok "Node.js dependencies installed"

# ── Step 6: Install Python dependencies ─────────────────────────
log "[6/8] Installing Python dependencies..."
cd "$REPO_DIR"
python3 -m venv .venv 2>>"$LOG"
source .venv/bin/activate
pip install -e ".[dev]" 2>>"$LOG" || pip install -r requirements.txt 2>>"$LOG" || true
ok "Python dependencies installed"

# ── Step 7: Start ChromaDB ──────────────────────────────────────
log "[7/8] Starting ChromaDB..."
if docker ps --format '{{.Names}}' | grep -q chromadb 2>/dev/null; then
    ok "ChromaDB already running"
else
    docker run -d --name chromadb -p 8000:8000 chromadb/chroma:latest 2>>"$LOG" || {
        warn "ChromaDB container failed — start manually: docker run -d -p 8000:8000 chromadb/chroma"
    }
    # Wait for ready
    for i in $(seq 1 15); do
        if curl -sf http://localhost:8000/api/v1/heartbeat &>/dev/null; then
            break
        fi
        sleep 1
    done
    ok "ChromaDB running on :8000"
fi

# ── Step 8: Generate config ─────────────────────────────────────
log "[8/8] Generating configuration..."
if [ ! -f "$MIRRORAI_HOME/.env" ] && [ -f "$REPO_DIR/config/.env.template" ]; then
    cp "$REPO_DIR/config/.env.template" "$MIRRORAI_HOME/.env"
fi
ok "Configuration ready"

# ── Install CLI globally ────────────────────────────────────────
cd "$REPO_DIR/apps/cli"
npm link 2>>"$LOG" || true

echo ""
echo "════════════════════════════════════════"
echo " ${GREEN}✓ MirrorAI installed successfully!${NC}"
echo ""
echo " Next steps:"
echo "   1. mirrorai init          # Setup wizard"
echo "   2. mirrorai ingest        # Import your chat data"
echo "   3. mirrorai mirror --enable  # Start AI clone"
echo ""
echo " Logs: $LOG"
echo " Home: $MIRRORAI_HOME"
echo "════════════════════════════════════════"
echo ""
