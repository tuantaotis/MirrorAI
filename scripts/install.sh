#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# MirrorAI — Fully Automated Installer for macOS
# Usage: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tuantaotis/MirrorAI/main/scripts/install.sh)"
#
# Features:
#   - Auto-detect hardware (Apple Silicon / Intel, RAM)
#   - Auto-select optimal AI model based on RAM
#   - Auto-install all dependencies (Homebrew, Node, Python, Docker, Ollama)
#   - Auto-start services (Ollama, ChromaDB)
#   - Auto-generate config & .env
#   - Auto-health-check all services
#   - Zero user interaction required
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────
VERSION="2.0.0"
MIRRORAI_HOME="$HOME/.mirrorai"
REPO_DIR="$MIRRORAI_HOME/app"
LOG="$MIRRORAI_HOME/install.log"
REPO_URL="https://github.com/tuantaotis/MirrorAI.git"
CHROMADB_PORT=8000
OLLAMA_PORT=11434
TOTAL_STEPS=12

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────
STEP=0
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; echo "[$(date +%H:%M:%S)] $1" >> "$LOG" 2>/dev/null || true; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; echo "  ✓ $1" >> "$LOG" 2>/dev/null || true; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; echo "  ⚠ $1" >> "$LOG" 2>/dev/null || true; }
err()  { echo -e "${RED}  ✗${NC} $1"; echo "  ✗ $1" >> "$LOG" 2>/dev/null || true; }
step() { STEP=$((STEP + 1)); echo ""; log "${BOLD}[$STEP/$TOTAL_STEPS]${NC} $1"; }
spin() {
    local pid=$1 msg=$2
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r${CYAN}  ${frames[$i]}${NC} %s" "$msg"
        i=$(( (i + 1) % ${#frames[@]} ))
        sleep 0.1
    done
    printf "\r"
}

# ── Error handler ─────────────────────────────────────────────────────────
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        echo ""
        err "Installation failed at step $STEP/$TOTAL_STEPS (exit code: $exit_code)"
        err "Check log: $LOG"
        echo ""
        echo -e "${DIM}  To retry from where it stopped:${NC}"
        echo -e "${DIM}  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/tuantaotis/MirrorAI/main/scripts/install.sh)\"${NC}"
    fi
}
trap cleanup EXIT

# ══════════════════════════════════════════════════════════════════════════
#  BANNER
# ══════════════════════════════════════════════════════════════════════════
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   🪞 MirrorAI — Fully Automated Installer    ║${NC}"
echo -e "${BOLD}║              v${VERSION}                          ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── Create home directory ─────────────────────────────────────────────────
mkdir -p "$MIRRORAI_HOME"/{data,logs,sessions,queue}
touch "$LOG"
echo "=== MirrorAI Install Started: $(date) ===" >> "$LOG"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 1: Detect Hardware
# ══════════════════════════════════════════════════════════════════════════
step "Detecting hardware..."

ARCH=$(uname -m)
RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
RAM_GB=$((RAM_BYTES / 1073741824))
CPU_BRAND=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown")
OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "Unknown")
CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "0")

# Detect Apple Silicon
IS_APPLE_SILICON=false
if [ "$ARCH" = "arm64" ]; then
    IS_APPLE_SILICON=true
fi

# Auto-select model based on RAM
if [ "$RAM_GB" -ge 48 ]; then
    SELECTED_MODEL="qwen2.5:32b"
    MODEL_SIZE="~20GB"
    QUALITY="Best — near cloud-quality"
elif [ "$RAM_GB" -ge 24 ]; then
    SELECTED_MODEL="qwen2.5:14b"
    MODEL_SIZE="~9GB"
    QUALITY="Great — recommended"
elif [ "$RAM_GB" -ge 16 ]; then
    SELECTED_MODEL="qwen2.5:7b"
    MODEL_SIZE="~4.7GB"
    QUALITY="Good — casual chat"
else
    SELECTED_MODEL="qwen2.5:3b"
    MODEL_SIZE="~2GB"
    QUALITY="Basic — lightweight"
fi

ok "macOS $OS_VERSION | $ARCH | ${RAM_GB}GB RAM | ${CORES} cores"
ok "CPU: $CPU_BRAND"
ok "Apple Silicon: $IS_APPLE_SILICON (Metal GPU acceleration)"
ok "Auto-selected model: ${BOLD}$SELECTED_MODEL${NC} ($MODEL_SIZE) — $QUALITY"

echo "Hardware: macOS $OS_VERSION, $ARCH, ${RAM_GB}GB RAM, $CORES cores" >> "$LOG"
echo "Selected model: $SELECTED_MODEL" >> "$LOG"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 2: Homebrew
# ══════════════════════════════════════════════════════════════════════════
step "Checking Homebrew..."

if command -v brew &>/dev/null; then
    ok "Homebrew already installed ($(brew --version | head -1))"
else
    log "Installing Homebrew (this may take a minute)..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >> "$LOG" 2>&1

    # Add brew to PATH for Apple Silicon
    if [ "$IS_APPLE_SILICON" = true ] && [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        # Persist to shell profile
        SHELL_PROFILE="$HOME/.zprofile"
        if ! grep -q 'homebrew' "$SHELL_PROFILE" 2>/dev/null; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$SHELL_PROFILE"
        fi
    fi
    ok "Homebrew installed"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 3: System Dependencies (parallel where possible)
# ══════════════════════════════════════════════════════════════════════════
step "Installing system dependencies..."

NEED_NODE=false
NEED_PYTHON=false
NEED_GIT=false

# Check Node.js
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VERSION" -lt 18 ]; then
    NEED_NODE=true
fi

# Check Python
if ! python3 --version 2>/dev/null | grep -qE "3\.(1[0-9]|[2-9][0-9])"; then
    NEED_PYTHON=true
fi

# Check git
if ! command -v git &>/dev/null; then
    NEED_GIT=true
fi

# Install missing deps
BREW_PACKAGES=""
[ "$NEED_NODE" = true ] && BREW_PACKAGES="$BREW_PACKAGES node@20"
[ "$NEED_PYTHON" = true ] && BREW_PACKAGES="$BREW_PACKAGES python@3.12"
[ "$NEED_GIT" = true ] && BREW_PACKAGES="$BREW_PACKAGES git"

if [ -n "$BREW_PACKAGES" ]; then
    log "Installing:$BREW_PACKAGES"
    brew install $BREW_PACKAGES >> "$LOG" 2>&1
    # Link node if needed
    if [ "$NEED_NODE" = true ]; then
        brew link node@20 --force >> "$LOG" 2>&1 || true
    fi
fi

ok "Node.js $(node -v 2>/dev/null || echo '—')"
ok "Python $(python3 --version 2>/dev/null | awk '{print $2}' || echo '—')"
ok "Git $(git --version 2>/dev/null | awk '{print $3}' || echo '—')"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 4: Docker
# ══════════════════════════════════════════════════════════════════════════
step "Setting up Docker..."

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker already running ($(docker --version | awk '{print $3}' | tr -d ','))"
else
    if ! command -v docker &>/dev/null; then
        log "Installing Docker Desktop..."
        brew install --cask docker >> "$LOG" 2>&1
    fi

    # Auto-start Docker Desktop
    log "Starting Docker Desktop..."
    open -a Docker 2>/dev/null || open /Applications/Docker.app 2>/dev/null || true

    # Wait for Docker to be ready (max 60s)
    DOCKER_WAIT=0
    DOCKER_MAX=60
    while ! docker info &>/dev/null 2>&1; do
        if [ $DOCKER_WAIT -ge $DOCKER_MAX ]; then
            warn "Docker not ready after ${DOCKER_MAX}s — will retry ChromaDB later"
            break
        fi
        printf "\r${CYAN}  ⏳${NC} Waiting for Docker to start... (%ds/%ds)" "$DOCKER_WAIT" "$DOCKER_MAX"
        sleep 2
        DOCKER_WAIT=$((DOCKER_WAIT + 2))
    done
    printf "\r"

    if docker info &>/dev/null 2>&1; then
        ok "Docker Desktop running"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 5: Ollama
# ══════════════════════════════════════════════════════════════════════════
step "Setting up Ollama..."

if command -v ollama &>/dev/null; then
    ok "Ollama already installed"
else
    log "Installing Ollama..."
    brew install ollama >> "$LOG" 2>&1
    ok "Ollama installed"
fi

# Ensure Ollama is running
if ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    log "Starting Ollama service..."
    brew services start ollama >> "$LOG" 2>&1 || true

    # Wait for Ollama
    OLLAMA_WAIT=0
    while ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; do
        if [ $OLLAMA_WAIT -ge 15 ]; then
            # Try direct start as fallback
            ollama serve &>/dev/null &
            sleep 3
            break
        fi
        sleep 1
        OLLAMA_WAIT=$((OLLAMA_WAIT + 1))
    done
fi

if curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    ok "Ollama running on :$OLLAMA_PORT"
else
    warn "Ollama not responding — models will be pulled on first run"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 6: Pull AI Models
# ══════════════════════════════════════════════════════════════════════════
step "Downloading AI models..."

# Embedding model (required, small)
if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    ok "nomic-embed-text already downloaded"
else
    log "Pulling nomic-embed-text (~270MB)..."
    ollama pull nomic-embed-text >> "$LOG" 2>&1 && \
        ok "nomic-embed-text (embedding)" || \
        warn "Pull failed — will retry: ollama pull nomic-embed-text"
fi

# Chat model (auto-selected)
if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
    ok "$SELECTED_MODEL already downloaded"
else
    log "Pulling $SELECTED_MODEL ($MODEL_SIZE) — this may take several minutes..."
    ollama pull "$SELECTED_MODEL" >> "$LOG" 2>&1 && \
        ok "$SELECTED_MODEL (chat)" || \
        warn "Pull failed — will retry: ollama pull $SELECTED_MODEL"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 7: Clone Repository
# ══════════════════════════════════════════════════════════════════════════
step "Setting up MirrorAI repository..."

if [ -d "$REPO_DIR/.git" ]; then
    log "Updating existing installation..."
    cd "$REPO_DIR"
    git fetch origin >> "$LOG" 2>&1 || true
    git reset --hard origin/main >> "$LOG" 2>&1 || git pull >> "$LOG" 2>&1 || true
    ok "Updated to latest version"
else
    log "Cloning repository..."
    rm -rf "$REPO_DIR" 2>/dev/null || true
    git clone "$REPO_URL" "$REPO_DIR" >> "$LOG" 2>&1
    ok "Repository cloned"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 8: Node.js Dependencies
# ══════════════════════════════════════════════════════════════════════════
step "Installing Node.js dependencies..."

cd "$REPO_DIR"
npm install --workspaces >> "$LOG" 2>&1
npm run build --workspaces >> "$LOG" 2>&1 || true
ok "Node.js packages installed"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 9: Python Dependencies
# ══════════════════════════════════════════════════════════════════════════
step "Installing Python dependencies..."

cd "$REPO_DIR"

# Create venv if not exists
if [ ! -d ".venv" ]; then
    python3 -m venv .venv >> "$LOG" 2>&1
fi

# Activate and install
source .venv/bin/activate
pip install --upgrade pip >> "$LOG" 2>&1
pip install -e ".[dev]" >> "$LOG" 2>&1 || pip install -e . >> "$LOG" 2>&1 || {
    # Fallback: install core deps manually
    pip install chromadb langchain langchain-community underthesea scikit-learn pydantic httpx pyyaml rich >> "$LOG" 2>&1
}
ok "Python packages installed"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 10: ChromaDB
# ══════════════════════════════════════════════════════════════════════════
step "Starting ChromaDB..."

if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    ok "ChromaDB already running on :$CHROMADB_PORT"
elif docker info &>/dev/null 2>&1; then
    # Remove old container if exists but stopped
    docker rm -f chromadb >> "$LOG" 2>&1 || true

    log "Starting ChromaDB container..."
    docker run -d \
        --name chromadb \
        --restart unless-stopped \
        -p $CHROMADB_PORT:8000 \
        -v "$MIRRORAI_HOME/data/chromadb:/chroma/chroma" \
        chromadb/chroma:latest >> "$LOG" 2>&1

    # Wait for ready
    CHROMA_WAIT=0
    while ! curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; do
        if [ $CHROMA_WAIT -ge 30 ]; then
            warn "ChromaDB not ready after 30s — check: docker logs chromadb"
            break
        fi
        sleep 1
        CHROMA_WAIT=$((CHROMA_WAIT + 1))
    done

    if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
        ok "ChromaDB running on :$CHROMADB_PORT (data persisted to ~/.mirrorai/data/chromadb)"
    fi
else
    warn "Docker not available — start Docker Desktop then run: docker run -d --name chromadb -p 8000:8000 chromadb/chroma:latest"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 11: Auto-Generate Config
# ══════════════════════════════════════════════════════════════════════════
step "Auto-generating configuration..."

# Generate .env
cat > "$MIRRORAI_HOME/.env" << ENVEOF
# ═══════════════════════════════════════════════════════
# MirrorAI — Auto-generated $(date +%Y-%m-%d)
# ═══════════════════════════════════════════════════════

# ── Telegram ───────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
# TELEGRAM_API_ID=
# TELEGRAM_API_HASH=

# ── Zalo ───────────────────────────────────────────────
ZALO_BOT_TOKEN=
# Zalo Personal: uses QR login, no token needed

# ── AI Providers (Optional — for cloud fallback) ──────
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AI...

# ── Ollama (auto-configured) ──────────────────────────
OLLAMA_URL=http://localhost:${OLLAMA_PORT}

# ── ChromaDB (auto-configured) ────────────────────────
CHROMADB_URL=http://localhost:${CHROMADB_PORT}

# ── Logging ───────────────────────────────────────────
LOG_LEVEL=info
ENVEOF
ok ".env generated"

# Generate mirrorai.config.yaml with auto-detected model
cat > "$MIRRORAI_HOME/mirrorai.config.yaml" << YAMLEOF
# ═══════════════════════════════════════════════════════
# MirrorAI Config — Auto-generated $(date +%Y-%m-%d)
# Hardware: $ARCH | ${RAM_GB}GB RAM | $CORES cores
# ═══════════════════════════════════════════════════════

app:
  name: "MirrorAI"
  version: "1.0.0"
  data_dir: "$MIRRORAI_HOME"
  log_level: "info"

platforms:
  telegram:
    enabled: false
    bot_token: "\${TELEGRAM_BOT_TOKEN}"
    export_path: ""
  zalo:
    enabled: false
    mode: "personal"
    bot_token: "\${ZALO_BOT_TOKEN}"

model:
  primary: "ollama/$SELECTED_MODEL"
  fallback: "anthropic/claude-sonnet-4-6"
  temperature: 0.8

embedding:
  provider: "ollama"
  model: "nomic-embed-text"
  batch_size: 100

vectordb:
  provider: "chromadb"
  url: "http://localhost:$CHROMADB_PORT"
  collection: "user_messages"

pipeline:
  chunk_size: 512
  chunk_overlap: 50
  min_message_words: 3
  max_history_days: 365

persona:
  confidence_threshold: 0.65
  response_delay_min_ms: 800
  response_delay_max_ms: 8000
  auto_reply: true
  manual_review_queue: true
  update_interval_min: 30

openclaw:
  workspace: "$REPO_DIR/workspace"
  gateway_port: 18789
YAMLEOF
ok "mirrorai.config.yaml generated (model: $SELECTED_MODEL)"

# Initialize state
cat > "$MIRRORAI_HOME/state.json" << STATEEOF
{
  "state": "READY",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$VERSION",
  "hardware": {
    "arch": "$ARCH",
    "ram_gb": $RAM_GB,
    "cores": $CORES,
    "apple_silicon": $IS_APPLE_SILICON
  },
  "model": {
    "chat": "$SELECTED_MODEL",
    "embedding": "nomic-embed-text"
  },
  "platforms": {},
  "persona_built": false,
  "mirroring": false
}
STATEEOF
ok "State initialized"

# ══════════════════════════════════════════════════════════════════════════
#  STEP 12: Install CLI + Health Check
# ══════════════════════════════════════════════════════════════════════════
step "Installing CLI & running health check..."

# Link CLI globally
cd "$REPO_DIR/apps/cli"
npm link >> "$LOG" 2>&1 || {
    # Fallback: add to PATH
    SHELL_PROFILE="$HOME/.zprofile"
    if ! grep -q 'mirrorai' "$SHELL_PROFILE" 2>/dev/null; then
        echo "export PATH=\"$REPO_DIR/apps/cli/node_modules/.bin:\$PATH\"" >> "$SHELL_PROFILE"
    fi
}
ok "CLI installed"

# Health check
echo ""
log "${BOLD}Running health check...${NC}"

HC_PASS=0
HC_TOTAL=4

# Check Ollama
if curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    ok "Ollama        ✅ running"; HC_PASS=$((HC_PASS + 1))
else
    err "Ollama        ❌ not running"
fi

# Check ChromaDB
if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    ok "ChromaDB      ✅ running"; HC_PASS=$((HC_PASS + 1))
else
    err "ChromaDB      ❌ not running"
fi

# Check chat model
if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
    ok "Chat model    ✅ $SELECTED_MODEL"; HC_PASS=$((HC_PASS + 1))
else
    err "Chat model    ❌ $SELECTED_MODEL not found"
fi

# Check embedding model
if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    ok "Embedding     ✅ nomic-embed-text"; HC_PASS=$((HC_PASS + 1))
else
    err "Embedding     ❌ nomic-embed-text not found"
fi

# ══════════════════════════════════════════════════════════════════════════
#  DONE
# ══════════════════════════════════════════════════════════════════════════
ELAPSED=$SECONDS
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
if [ $HC_PASS -eq $HC_TOTAL ]; then
    echo -e "  ${GREEN}${BOLD}✅ MirrorAI installed successfully!${NC}"
else
    echo -e "  ${YELLOW}${BOLD}⚠ MirrorAI installed with $((HC_TOTAL - HC_PASS)) warning(s)${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${DIM}Hardware${NC}     $ARCH | ${RAM_GB}GB RAM | Apple Silicon: $IS_APPLE_SILICON"
echo -e "  ${DIM}Model${NC}        $SELECTED_MODEL ($QUALITY)"
echo -e "  ${DIM}Health${NC}       $HC_PASS/$HC_TOTAL services OK"
echo -e "  ${DIM}Time${NC}         ${MINS}m ${SECS}s"
echo -e "  ${DIM}Home${NC}         $MIRRORAI_HOME"
echo -e "  ${DIM}Log${NC}          $LOG"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  ${GREEN}1.${NC} mirrorai init                    ${DIM}# Setup wizard${NC}"
echo -e "  ${GREEN}2.${NC} mirrorai ingest --platform=telegram --file=~/Downloads/result.json"
echo -e "  ${GREEN}3.${NC} mirrorai mirror --enable          ${DIM}# Start AI clone${NC}"
echo ""
echo -e "  ${DIM}Or quick-start with Zalo:${NC}"
echo -e "  ${GREEN}$${NC} mirrorai ingest --platform=zalo    ${DIM}# QR login → auto fetch${NC}"
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
