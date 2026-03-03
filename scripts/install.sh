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

# ── Progress Bar ────────────────────────────────────────────────────────
STEP=0
BAR_WIDTH=40

draw_progress() {
    local current=$1 total=$2 label="$3"
    local pct=$((current * 100 / total))
    local filled=$((current * BAR_WIDTH / total))
    local empty=$((BAR_WIDTH - filled))

    # Build bar
    local bar=""
    for ((b=0; b<filled; b++)); do bar+="█"; done
    for ((b=0; b<empty; b++)); do bar+="░"; done

    # Color based on progress
    local color="$CYAN"
    [ "$pct" -ge 50 ] && color="$YELLOW"
    [ "$pct" -ge 80 ] && color="$GREEN"

    printf "\r  ${color}${bar}${NC} ${BOLD}%3d%%${NC}  ${DIM}%s${NC}" "$pct" "$label"
}

# Persistent status line at bottom
STATUS_LINE=""
update_status() {
    STATUS_LINE="$1"
    printf "\r\033[K  ${CYAN}⟳${NC} ${DIM}%s${NC}" "$STATUS_LINE"
}
clear_status() {
    printf "\r\033[K"
}

# ── Logging ───────────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; echo "[$(date +%H:%M:%S)] $1" >> "$LOG" 2>/dev/null || true; }
ok()   { clear_status; echo -e "${GREEN}  ✓${NC} $1"; echo "  ✓ $1" >> "$LOG" 2>/dev/null || true; }
warn() { clear_status; echo -e "${YELLOW}  ⚠${NC} $1"; echo "  ⚠ $1" >> "$LOG" 2>/dev/null || true; }
err()  { clear_status; echo -e "${RED}  ✗${NC} $1"; echo "  ✗ $1" >> "$LOG" 2>/dev/null || true; }
step() {
    STEP=$((STEP + 1))
    echo ""
    draw_progress "$STEP" "$TOTAL_STEPS" "$1"
    echo ""
    log "${BOLD}[$STEP/$TOTAL_STEPS]${NC} $1"
}

# Spinner with elapsed time
spin() {
    local pid=$1 msg=$2
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0 elapsed=0
    while kill -0 "$pid" 2>/dev/null; do
        local mins=$((elapsed / 60))
        local secs=$((elapsed % 60))
        local time_str=""
        if [ $mins -gt 0 ]; then
            time_str="${mins}m${secs}s"
        else
            time_str="${secs}s"
        fi
        printf "\r  ${CYAN}${frames[$i]}${NC} %s ${DIM}(%s)${NC}\033[K" "$msg" "$time_str"
        i=$(( (i + 1) % ${#frames[@]} ))
        sleep 0.1
        elapsed=$(awk "BEGIN{print $elapsed + 0.1}" | cut -d. -f1)
        # increment integer seconds
        if (( (RANDOM % 10) == 0 )); then
            elapsed=$((elapsed + 1))
        fi
    done
    printf "\r\033[K"
}

# Run command with spinner + elapsed time
run_with_status() {
    local msg="$1"
    shift
    "$@" >> "$LOG" 2>&1 &
    local pid=$!
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    local start_ts=$SECONDS
    while kill -0 "$pid" 2>/dev/null; do
        local elapsed=$((SECONDS - start_ts))
        local mins=$((elapsed / 60))
        local secs=$((elapsed % 60))
        printf "\r  ${CYAN}${frames[$i]}${NC} %s ${DIM}(%dm%02ds)${NC}\033[K" "$msg" "$mins" "$secs"
        i=$(( (i + 1) % ${#frames[@]} ))
        sleep 0.1
    done
    printf "\r\033[K"
    wait "$pid"
    return $?
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
    run_with_status "Installing Homebrew..." env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

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

# Helper: install brew package with retry + postinstall fix
brew_install_safe() {
    local pkg="$1"
    local max_retries=2

    for attempt in $(seq 1 $max_retries); do
        if run_with_status "Installing $pkg via Homebrew (attempt $attempt/$max_retries)..." brew install "$pkg"; then
            ok "$pkg installed"
            return 0
        fi

        # Common fix: openssl postinstall fails on older macOS
        if [ "$attempt" -lt "$max_retries" ]; then
            warn "$pkg install failed — attempting recovery..."

            # Fix openssl postinstall (common issue on macOS <14)
            if brew list openssl@3 &>/dev/null 2>&1; then
                run_with_status "Retrying openssl@3 postinstall..." brew postinstall openssl@3 || true
            fi

            # Update Xcode CLT linkage
            if [ -d "/Library/Developer/CommandLineTools" ]; then
                run_with_status "Resetting Xcode CLT path..." sudo xcode-select --reset 2>/dev/null || true
            fi
        fi
    done

    err "$pkg failed after $max_retries attempts"
    return 1
}

# Install missing deps
BREW_PACKAGES=""
[ "$NEED_GIT" = true ] && BREW_PACKAGES="$BREW_PACKAGES git"
[ "$NEED_NODE" = true ] && BREW_PACKAGES="$BREW_PACKAGES node@20"
[ "$NEED_PYTHON" = true ] && BREW_PACKAGES="$BREW_PACKAGES python@3.12"

if [ -n "$BREW_PACKAGES" ]; then
    # Pre-fix: ensure openssl@3 postinstall is clean before installing python
    if [ "$NEED_PYTHON" = true ] && brew list openssl@3 &>/dev/null 2>&1; then
        log "Pre-fixing openssl@3 postinstall..."
        run_with_status "Running brew postinstall openssl@3..." brew postinstall openssl@3 || true
    fi

    for pkg in $BREW_PACKAGES; do
        brew_install_safe "$pkg" || {
            # Fallback for Python: try python@3.11 or system python
            if [[ "$pkg" == "python@3.12" ]]; then
                warn "Trying python@3.11 as fallback..."
                brew_install_safe "python@3.11" || {
                    warn "Brew Python failed — checking if system python3 is usable..."
                    if python3 --version 2>/dev/null | grep -qE "3\.[89]|3\.1[0-9]"; then
                        ok "Using system Python: $(python3 --version 2>/dev/null)"
                    else
                        err "No usable Python found. Please install manually: brew install python@3.12"
                        exit 1
                    fi
                }
            else
                err "Failed to install $pkg"
                exit 1
            fi
        }
    done
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
        run_with_status "Installing Docker Desktop..." brew install --cask docker
    fi

    # Auto-start Docker Desktop
    log "Starting Docker Desktop..."
    open -a Docker 2>/dev/null || open /Applications/Docker.app 2>/dev/null || true

    # Wait for Docker to be ready (max 60s)
    DOCKER_WAIT=0
    DOCKER_MAX=60
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local fi=0
    while ! docker info &>/dev/null 2>&1; do
        if [ $DOCKER_WAIT -ge $DOCKER_MAX ]; then
            printf "\r\033[K"
            warn "Docker not ready after ${DOCKER_MAX}s — will retry ChromaDB later"
            break
        fi
        printf "\r  ${CYAN}${frames[$fi]}${NC} Waiting for Docker to start... ${DIM}(%ds/%ds)${NC}\033[K" "$DOCKER_WAIT" "$DOCKER_MAX"
        fi=$(( (fi + 1) % ${#frames[@]} ))
        sleep 2
        DOCKER_WAIT=$((DOCKER_WAIT + 2))
    done
    printf "\r\033[K"

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
    run_with_status "Installing Ollama..." brew install ollama
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
    run_with_status "Pulling nomic-embed-text (~270MB)..." ollama pull nomic-embed-text && \
        ok "nomic-embed-text (embedding)" || \
        warn "Pull failed — will retry: ollama pull nomic-embed-text"
fi

# Chat model (auto-selected)
if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
    ok "$SELECTED_MODEL already downloaded"
else
    run_with_status "Pulling $SELECTED_MODEL ($MODEL_SIZE)..." ollama pull "$SELECTED_MODEL" && \
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
    run_with_status "Cloning MirrorAI repository..." git clone "$REPO_URL" "$REPO_DIR"
    ok "Repository cloned"
fi

# ══════════════════════════════════════════════════════════════════════════
#  STEP 8: Node.js Dependencies
# ══════════════════════════════════════════════════════════════════════════
step "Installing Node.js dependencies..."

cd "$REPO_DIR"
run_with_status "npm install (workspaces)..." npm install --workspaces
run_with_status "npm build (workspaces)..." npm run build --workspaces || true
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
run_with_status "Upgrading pip..." pip install --upgrade pip
run_with_status "Installing Python packages..." pip install -e ".[dev]" || \
    run_with_status "Installing Python packages (fallback)..." pip install -e . || {
    run_with_status "Installing core deps manually..." pip install chromadb langchain langchain-community underthesea scikit-learn pydantic httpx pyyaml rich
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
