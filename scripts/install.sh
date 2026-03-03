#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# MirrorAI — Smart Installer v4.0 for macOS
# Usage: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tuantaotis/MirrorAI/main/scripts/install.sh)"
#
# Features:
#   - Instant install (~3-5 min) — usable immediately in cloud mode
#   - Background Phase 2: Ollama + models + ChromaDB auto-setup
#   - Auto-switches to local mode when Phase 2 completes
#   - Smart macOS version detection (Tier 1/2/3 compatibility)
#   - Error Recovery Engine + AI diagnosis
#   - Progress bar + spinner with elapsed time
#   - Zero user interaction required
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail
# NOTE: no `set -e` — we handle errors manually via diagnose_and_fix()

# ── Constants ─────────────────────────────────────────────────────────────
VERSION="4.0.0"
MIRRORAI_HOME="$HOME/.mirrorai"
REPO_DIR="$MIRRORAI_HOME/app"
LOG="$MIRRORAI_HOME/install.log"
REPO_URL="https://github.com/tuantaotis/MirrorAI.git"
CHROMADB_PORT=8000
OLLAMA_PORT=11434
TOTAL_STEPS=8
PHASE2_LOG="$MIRRORAI_HOME/logs/phase2.log"
PHASE2_SCRIPT="$MIRRORAI_HOME/phase2-setup.sh"

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Progress Bar ──────────────────────────────────────────────────────────
STEP=0
BAR_WIDTH=40

draw_progress() {
    local current=$1 total=$2 label="$3"
    local pct=$((current * 100 / total))
    local filled=$((current * BAR_WIDTH / total))
    local empty=$((BAR_WIDTH - filled))

    local bar=""
    for ((b=0; b<filled; b++)); do bar+="█"; done
    for ((b=0; b<empty; b++)); do bar+="░"; done

    local color="$CYAN"
    [ "$pct" -ge 50 ] && color="$YELLOW"
    [ "$pct" -ge 80 ] && color="$GREEN"

    printf "\r  ${color}${bar}${NC} ${BOLD}%3d%%${NC}  ${DIM}%s${NC}" "$pct" "$label"
}

clear_status() { printf "\r\033[K"; }

# ── Logging ───────────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; echo "[$(date +%H:%M:%S)] $1" >> "$LOG" 2>/dev/null || true; }
ok()   { clear_status; echo -e "${GREEN}  ✓${NC} $1"; echo "  ✓ $1" >> "$LOG" 2>/dev/null || true; }
warn() { clear_status; echo -e "${YELLOW}  ⚠${NC} $1"; echo "  ⚠ $1" >> "$LOG" 2>/dev/null || true; }
err()  { clear_status; echo -e "${RED}  ✗${NC} $1"; echo "  ✗ $1" >> "$LOG" 2>/dev/null || true; }
info() { clear_status; echo -e "${MAGENTA}  ℹ${NC} $1"; echo "  ℹ $1" >> "$LOG" 2>/dev/null || true; }
step() {
    STEP=$((STEP + 1))
    echo ""
    draw_progress "$STEP" "$TOTAL_STEPS" "$1"
    echo ""
    log "${BOLD}[$STEP/$TOTAL_STEPS]${NC} $1"
}

# ── Run command with spinner + elapsed time ───────────────────────────────
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

# ═══════════════════════════════════════════════════════════════════════════
#  ERROR RECOVERY ENGINE
# ═══════════════════════════════════════════════════════════════════════════
RECOVERY_ATTEMPTED=false

diagnose_and_fix() {
    local step_name="$1"
    local exit_code="$2"
    local error_context="${3:-}"

    if [ -z "$error_context" ]; then
        error_context=$(tail -50 "$LOG" 2>/dev/null || echo "no log")
    fi

    echo ""
    log "${MAGENTA}🔍 Error Recovery Engine — analyzing failure...${NC}"
    echo "$error_context" >> "$LOG" 2>/dev/null || true

    case "$error_context" in
        *"does not run on macOS versions older"*)
            warn "DIAGNOSED: Tool incompatible with this macOS version"
            info "AUTO-FIX: Skipping to compatible fallback..."
            return 0
            ;;
        *"postinstall"*"openssl"*|*"openssl@3"*"Error"*)
            warn "DIAGNOSED: openssl@3 postinstall failure"
            info "AUTO-FIX: Running brew postinstall openssl@3..."
            brew postinstall openssl@3 >> "$LOG" 2>&1 || true
            return 0
            ;;
        *"No space left on device"*|*"ENOSPC"*)
            err "DIAGNOSED: Disk full — need at least 10GB free"
            local free_gb=$(df -g / 2>/dev/null | tail -1 | awk '{print $4}')
            err "Available: ${free_gb:-?}GB. Free up space and retry."
            return 1
            ;;
        *"Permission denied"*|*"EACCES"*)
            warn "DIAGNOSED: Permission issue"
            info "AUTO-FIX: Fixing Homebrew permissions..."
            sudo chown -R "$(whoami)" /usr/local/share /usr/local/lib /usr/local/include 2>/dev/null || true
            sudo chown -R "$(whoami)" "$(brew --prefix)"/* 2>/dev/null || true
            return 0
            ;;
        *"Could not resolve host"*|*"Failed to connect"*|*"Network is unreachable"*)
            warn "DIAGNOSED: Network connectivity issue"
            info "Checking internet..."
            if curl -sf --max-time 5 https://google.com &>/dev/null; then
                info "Internet OK — DNS may be slow, retrying..."
                return 0
            else
                err "No internet connection. Connect to WiFi/Ethernet and retry."
                return 1
            fi
            ;;
        *"Xcode"*|*"xcrun"*|*"CLT"*|*"command line tools"*)
            warn "DIAGNOSED: Xcode Command Line Tools issue"
            info "AUTO-FIX: Installing/resetting Xcode CLT..."
            sudo xcode-select --reset 2>/dev/null || true
            xcode-select --install 2>/dev/null || true
            return 0
            ;;
        *"already installed"*|*"already linked"*)
            info "DIAGNOSED: Already installed — not an error"
            return 0
            ;;
        *"port"*"already in use"*|*"EADDRINUSE"*)
            warn "DIAGNOSED: Port already in use"
            local port=$(echo "$error_context" | grep -oE '[0-9]{4,5}' | head -1)
            info "AUTO-FIX: Killing process on port ${port:-unknown}..."
            lsof -ti ":${port:-8000}" 2>/dev/null | xargs kill -9 2>/dev/null || true
            return 0
            ;;
        *"brew"*"update"*|*"shallow clone"*)
            warn "DIAGNOSED: Homebrew needs update"
            info "AUTO-FIX: Running brew update..."
            brew update >> "$LOG" 2>&1 || true
            return 0
            ;;
        *)
            warn "Unknown error — attempting AI diagnosis..."
            ai_diagnose "$step_name" "$error_context"
            return $?
            ;;
    esac
}

# ── AI Fallback Diagnosis ─────────────────────────────────────────────────
ai_diagnose() {
    local step_name="$1"
    local error_text="$2"

    if ! curl -sf --max-time 3 https://google.com &>/dev/null; then
        err "No internet — cannot use AI diagnosis"
        err "Error context: $(echo "$error_text" | tail -5)"
        return 1
    fi

    local key_lines
    key_lines=$(echo "$error_text" | grep -iE 'error|fail|fatal|cannot|unable|denied|not found' | tail -10)
    [ -z "$key_lines" ] && key_lines=$(echo "$error_text" | tail -10)

    info "Searching for solution online..."

    local search_query="macOS brew install error $(echo "$key_lines" | head -1 | tr -d '\n' | head -c 100)"
    local encoded_query
    encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$search_query'))" 2>/dev/null || echo "")

    if [ -n "$encoded_query" ]; then
        local response
        response=$(curl -sf --max-time 5 "https://api.duckduckgo.com/?q=${encoded_query}&format=json&no_html=1" 2>/dev/null || echo "")
        local abstract
        abstract=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('AbstractText','')[:200])" 2>/dev/null || echo "")

        if [ -n "$abstract" ]; then
            info "Possible solution: $abstract"
        fi
    fi

    echo ""
    echo -e "  ${DIM}─── Error details (last 5 lines) ───${NC}"
    echo "$key_lines" | tail -5 | while IFS= read -r line; do
        echo -e "  ${DIM}│ $line${NC}"
    done
    echo -e "  ${DIM}─────────────────────────────────────${NC}"
    echo ""
    info "Full log: $LOG"

    return 1
}

# ── Brew install with recovery ────────────────────────────────────────────
brew_install_safe() {
    local pkg="$1"
    local max_retries=3

    for attempt in $(seq 1 $max_retries); do
        if run_with_status "Installing $pkg via Homebrew (attempt $attempt/$max_retries)..." brew install "$pkg"; then
            ok "$pkg installed"
            return 0
        fi

        local log_tail
        log_tail=$(tail -30 "$LOG" 2>/dev/null || echo "")
        if diagnose_and_fix "brew install $pkg" "$?" "$log_tail"; then
            log "Recovery applied — retrying $pkg..."
        else
            break
        fi
    done

    err "$pkg failed after $max_retries attempts"
    return 1
}

# ═══════════════════════════════════════════════════════════════════════════
#  BANNER
# ═══════════════════════════════════════════════════════════════════════════
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   🪞 MirrorAI — Smart Installer v${VERSION}       ║${NC}"
echo -e "${BOLD}║   ⚡ Fast install → background AI setup       ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── Create home directory ─────────────────────────────────────────────────
mkdir -p "$MIRRORAI_HOME"/{data,logs,sessions,queue}
touch "$LOG"
echo "=== MirrorAI Install v$VERSION Started: $(date) ===" >> "$LOG"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 1: Detect Hardware + macOS Compatibility Tier
# ═══════════════════════════════════════════════════════════════════════════
step "Detecting hardware & compatibility..."

ARCH=$(uname -m)
RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
RAM_GB=$((RAM_BYTES / 1073741824))
CPU_BRAND=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown")
OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "Unknown")
CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "0")
OS_MAJOR=$(echo "$OS_VERSION" | cut -d'.' -f1)

IS_APPLE_SILICON=false
[ "$ARCH" = "arm64" ] && IS_APPLE_SILICON=true

CAN_DOCKER=false
CAN_COLIMA=false
CAN_OLLAMA=true
BREW_HAS_BOTTLES=false
CHROMADB_MODE="pip"
USE_CLOUD_LLM=false
COMPAT_TIER=0

if [ "$OS_MAJOR" -lt 12 ]; then
    echo ""
    err "macOS $OS_VERSION is not supported (minimum: macOS 12 Monterey)"
    err "Please upgrade macOS: System Settings → General → Software Update"
    exit 1
elif [ "$OS_MAJOR" -ge 14 ]; then
    COMPAT_TIER=1; CAN_DOCKER=true; CAN_COLIMA=true; BREW_HAS_BOTTLES=true; CHROMADB_MODE="docker"
elif [ "$OS_MAJOR" -ge 13 ]; then
    COMPAT_TIER=2; CAN_COLIMA=true; CAN_OLLAMA=true; CHROMADB_MODE="docker"
else
    COMPAT_TIER=3; CAN_OLLAMA=true; CHROMADB_MODE="pip"
fi

# Auto-select model based on RAM
if [ "$CAN_OLLAMA" = true ]; then
    if [ "$RAM_GB" -ge 64 ]; then
        SELECTED_MODEL="qwen2.5:32b"; MODEL_SIZE="~20GB"; QUALITY="Best"
    elif [ "$RAM_GB" -ge 48 ]; then
        SELECTED_MODEL="qwen2.5:14b"; MODEL_SIZE="~9GB"; QUALITY="Great"
    elif [ "$RAM_GB" -ge 24 ]; then
        SELECTED_MODEL="qwen2.5:7b"; MODEL_SIZE="~4.7GB"; QUALITY="Great"
    elif [ "$RAM_GB" -ge 16 ]; then
        SELECTED_MODEL="qwen2.5:3b"; MODEL_SIZE="~2GB"; QUALITY="Good"
    elif [ "$RAM_GB" -ge 8 ]; then
        SELECTED_MODEL="qwen2.5:1.5b"; MODEL_SIZE="~1GB"; QUALITY="Good"
    else
        SELECTED_MODEL="qwen2.5:0.5b"; MODEL_SIZE="~400MB"; QUALITY="Basic"
    fi
else
    SELECTED_MODEL="gemini/gemini-2.5-flash"; MODEL_SIZE="cloud"; QUALITY="Cloud API"
fi

ok "macOS $OS_VERSION | $ARCH | ${RAM_GB}GB RAM | ${CORES} cores"
ok "CPU: $CPU_BRAND"

TIER_NAMES=("" "FULL SUPPORT" "PARTIAL SUPPORT" "MINIMAL SUPPORT")
TIER_COLORS=("" "$GREEN" "$YELLOW" "$RED")

echo ""
echo -e "  ${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "  ${BOLD}║  macOS $OS_VERSION — TIER $COMPAT_TIER: ${TIER_COLORS[$COMPAT_TIER]}${TIER_NAMES[$COMPAT_TIER]}${NC}${BOLD}$(printf '%*s' $((16 - ${#TIER_NAMES[$COMPAT_TIER]})) '')║${NC}"
echo -e "  ${BOLD}║  AI Model: $SELECTED_MODEL ($MODEL_SIZE)$(printf '%*s' $((27 - ${#SELECTED_MODEL} - ${#MODEL_SIZE})) '')║${NC}"
echo -e "  ${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

echo "Hardware: macOS $OS_VERSION, $ARCH, ${RAM_GB}GB RAM, $CORES cores, Tier $COMPAT_TIER" >> "$LOG"
echo "Selected model: $SELECTED_MODEL ($MODEL_SIZE)" >> "$LOG"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 2: Homebrew
# ═══════════════════════════════════════════════════════════════════════════
step "Checking Homebrew..."

if command -v brew &>/dev/null; then
    ok "Homebrew already installed ($(brew --version | head -1))"
else
    log "Installing Homebrew..."
    if run_with_status "Installing Homebrew..." env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
        ok "Homebrew installed"
    else
        diagnose_and_fix "Homebrew install" "$?" ""
        run_with_status "Retrying Homebrew install..." env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
            err "Homebrew installation failed — cannot continue"
            exit 1
        }
    fi

    if [ "$IS_APPLE_SILICON" = true ] && [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        SHELL_PROFILE="$HOME/.zprofile"
        if ! grep -q 'homebrew' "$SHELL_PROFILE" 2>/dev/null; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$SHELL_PROFILE"
        fi
    fi
fi

if [ "$BREW_HAS_BOTTLES" = false ]; then
    warn "macOS $OS_VERSION: Homebrew may compile packages from source (~20-30 min)"
    run_with_status "Updating Homebrew formulae..." brew update || true
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 3: System Dependencies
# ═══════════════════════════════════════════════════════════════════════════
step "Installing system dependencies..."

NEED_NODE=false
NEED_PYTHON=false
NEED_GIT=false

NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
[ "$NODE_VERSION" -lt 18 ] && NEED_NODE=true

if ! python3 --version 2>/dev/null | grep -qE "3\.(1[0-9]|[2-9][0-9])"; then
    NEED_PYTHON=true
fi

command -v git &>/dev/null || NEED_GIT=true

if [ "$NEED_PYTHON" = true ] && [ "$BREW_HAS_BOTTLES" = false ]; then
    if brew list openssl@3 &>/dev/null 2>&1; then
        run_with_status "Running brew postinstall openssl@3..." brew postinstall openssl@3 || true
    fi
fi

[ "$NEED_GIT" = true ] && { brew_install_safe git || exit 1; }

if [ "$NEED_NODE" = true ]; then
    brew_install_safe node@20 || {
        warn "node@20 failed, trying node@18..."
        brew_install_safe node@18 || { err "Cannot install Node.js"; exit 1; }
    }
    brew link node@20 --force >> "$LOG" 2>&1 || brew link node@18 --force >> "$LOG" 2>&1 || true
fi

if [ "$NEED_PYTHON" = true ]; then
    brew_install_safe python@3.12 || {
        warn "python@3.12 failed, trying python@3.11..."
        brew_install_safe python@3.11 || {
            if python3 --version 2>/dev/null | grep -qE "3\.[89]|3\.1[0-9]"; then
                ok "Using system Python: $(python3 --version 2>/dev/null)"
            else
                err "No usable Python found"; exit 1
            fi
        }
    }
fi

ok "Node.js $(node -v 2>/dev/null || echo '—')"
ok "Python $(python3 --version 2>/dev/null | awk '{print $2}' || echo '—')"
ok "Git $(git --version 2>/dev/null | awk '{print $3}' || echo '—')"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 4: Clone Repository
# ═══════════════════════════════════════════════════════════════════════════
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
    if run_with_status "Cloning MirrorAI repository..." git clone "$REPO_URL" "$REPO_DIR"; then
        ok "Repository cloned"
    else
        diagnose_and_fix "git clone" "$?" ""
        run_with_status "Retrying clone..." git clone "$REPO_URL" "$REPO_DIR" || {
            err "Cannot clone repository"; exit 1
        }
        ok "Repository cloned (retry)"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 5: npm + pip install (PARALLEL)
# ═══════════════════════════════════════════════════════════════════════════
step "Installing dependencies (npm + pip in parallel)..."

cd "$REPO_DIR"

# Prepare Python venv
if [ ! -d ".venv" ]; then
    python3 -m venv .venv >> "$LOG" 2>&1
fi
source .venv/bin/activate
pip install --upgrade pip >> "$LOG" 2>&1

# Launch both in parallel
(npm ci --workspaces >> "$LOG" 2>&1 || npm install --workspaces >> "$LOG" 2>&1 || npm install >> "$LOG" 2>&1) &
NPM_PID=$!
(pip install -e ".[dev]" >> "$LOG" 2>&1 || pip install -e . >> "$LOG" 2>&1 || pip install chromadb langchain langchain-community underthesea scikit-learn pydantic httpx pyyaml rich >> "$LOG" 2>&1) &
PIP_PID=$!

# Wait with spinner
sp_frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
sp_i=0
sp_start=$SECONDS
while kill -0 "$NPM_PID" 2>/dev/null || kill -0 "$PIP_PID" 2>/dev/null; do
    sp_elapsed=$((SECONDS - sp_start))
    sp_mins=$((sp_elapsed / 60))
    sp_secs=$((sp_elapsed % 60))
    printf "\r  ${CYAN}${sp_frames[$sp_i]}${NC} npm + pip installing in parallel... ${DIM}(%dm%02ds)${NC}\033[K" "$sp_mins" "$sp_secs"
    sp_i=$(( (sp_i + 1) % ${#sp_frames[@]} ))
    sleep 0.1
done
printf "\r\033[K"

wait "$NPM_PID" && ok "npm packages installed" || warn "npm install had issues — check $LOG"
wait "$PIP_PID" && ok "Python packages installed" || warn "pip install had issues — check $LOG"

run_with_status "Building workspaces..." npm run build --workspaces 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 6: Auto-Generate Config
# ═══════════════════════════════════════════════════════════════════════════
step "Auto-generating configuration..."

# Default to cloud mode initially (local mode enabled after Phase 2)
MODEL_PRIMARY="gemini/gemini-2.5-flash"
MODEL_FALLBACK="ollama/$SELECTED_MODEL"
EMBEDDING_PROVIDER="ollama"

if [ "$USE_CLOUD_LLM" = true ]; then
    MODEL_FALLBACK="deepseek/deepseek-chat"
fi

# Generate .env
cat > "$MIRRORAI_HOME/.env" << ENVEOF
# ═══════════════════════════════════════════════════════
# MirrorAI — Auto-generated $(date +%Y-%m-%d)
# macOS $OS_VERSION ($ARCH) — Tier $COMPAT_TIER
# ═══════════════════════════════════════════════════════

# ── Telegram ───────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
# TELEGRAM_API_ID=
# TELEGRAM_API_HASH=

# ── Zalo ───────────────────────────────────────────────
ZALO_BOT_TOKEN=

# ── AI Providers ──────────────────────────────────────
# Cloud mode (active now — local mode auto-enables after Phase 2):
GEMINI_API_KEY=
# ANTHROPIC_API_KEY=sk-ant-...
# DEEPSEEK_API_KEY=sk-...

# ── Ollama ─────────────────────────────────────────────
OLLAMA_URL=http://localhost:${OLLAMA_PORT}

# ── ChromaDB ───────────────────────────────────────────
CHROMADB_URL=http://localhost:${CHROMADB_PORT}

# ── Logging ────────────────────────────────────────────
LOG_LEVEL=info
ENVEOF
ok ".env generated"

# Generate config
cat > "$MIRRORAI_HOME/mirrorai.config.yaml" << YAMLEOF
# ═══════════════════════════════════════════════════════
# MirrorAI Config — Auto-generated $(date +%Y-%m-%d)
# Hardware: $ARCH | ${RAM_GB}GB RAM | $CORES cores
# macOS: $OS_VERSION | Tier: $COMPAT_TIER
# ═══════════════════════════════════════════════════════

app:
  name: "MirrorAI"
  version: "1.0.0"
  data_dir: "$MIRRORAI_HOME"
  log_level: "info"
  compatibility_tier: $COMPAT_TIER

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
  primary: "$MODEL_PRIMARY"
  fallback: "$MODEL_FALLBACK"
  local_model: "ollama/$SELECTED_MODEL"
  temperature: 0.8
  cloud_mode: true

embedding:
  provider: "$EMBEDDING_PROVIDER"
  model: "nomic-embed-text"
  batch_size: 100

vectordb:
  provider: "chromadb"
  url: "http://localhost:$CHROMADB_PORT"
  collection: "user_messages"
  mode: "$CHROMADB_MODE"

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
ok "mirrorai.config.yaml generated"

# State
DOCKER_AVAILABLE=false
cat > "$MIRRORAI_HOME/state.json" << STATEEOF
{
  "state": "CLOUD_READY",
  "install_mode": "phase1_complete",
  "phase2_status": "pending",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$VERSION",
  "compatibility_tier": $COMPAT_TIER,
  "hardware": {
    "arch": "$ARCH",
    "ram_gb": $RAM_GB,
    "cores": $CORES,
    "apple_silicon": $IS_APPLE_SILICON,
    "macos_version": "$OS_VERSION"
  },
  "model": {
    "chat": "$SELECTED_MODEL",
    "chat_size": "$MODEL_SIZE",
    "embedding": "nomic-embed-text",
    "cloud_mode": true
  },
  "services": {
    "chromadb_mode": "$CHROMADB_MODE",
    "docker_available": false,
    "ollama_available": false
  },
  "platforms": {},
  "persona_built": false,
  "mirroring": false
}
STATEEOF
ok "State initialized"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 7: Install CLI
# ═══════════════════════════════════════════════════════════════════════════
step "Installing CLI..."

cd "$REPO_DIR/apps/cli" 2>/dev/null && {
    npm link >> "$LOG" 2>&1 || {
        SHELL_PROFILE="$HOME/.zprofile"
        if ! grep -q 'mirrorai' "$SHELL_PROFILE" 2>/dev/null; then
            echo "export PATH=\"$REPO_DIR/apps/cli/node_modules/.bin:\$PATH\"" >> "$SHELL_PROFILE"
        fi
    }
    ok "CLI installed (mirrorai command available)"
} || warn "CLI directory not found — skipping"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 8: Generate Phase 2 script + launch background setup
# ═══════════════════════════════════════════════════════════════════════════
step "Launching background AI setup (Phase 2)..."

mkdir -p "$MIRRORAI_HOME/logs"

# ── Generate Phase 2 background script ────────────────────────────────────
cat > "$PHASE2_SCRIPT" << 'PHASE2EOF'
#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# MirrorAI — Phase 2 Background Setup
# Auto-generated by installer. Sets up Ollama + models + ChromaDB.
# Runs in background — user notified on completion.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

MIRRORAI_HOME="$HOME/.mirrorai"
REPO_DIR="$MIRRORAI_HOME/app"
LOG="$MIRRORAI_HOME/logs/phase2.log"
STATE="$MIRRORAI_HOME/state.json"
OLLAMA_PORT=11434
CHROMADB_PORT=8000

echo "=== Phase 2 Started: $(date) ===" > "$LOG"

update_state() {
    local key="$1" val="$2"
    python3 -c "
import json, sys
with open('$STATE','r') as f: d=json.load(f)
keys = '$key'.split('.')
obj = d
for k in keys[:-1]: obj = obj[k]
try: obj[keys[-1]] = json.loads('$val')
except: obj[keys[-1]] = '$val'
with open('$STATE','w') as f: json.dump(d,f,indent=2)
" 2>/dev/null || true
}

update_state "phase2_status" '"in_progress"'

# ── 1. Container Runtime ──────────────────────────────────────────────────
echo "[$(date +%H:%M:%S)] Setting up container runtime..." >> "$LOG"

DOCKER_AVAILABLE=false
CHROMADB_MODE="pip"

PHASE2EOF

# Inject tier-specific container logic
if [ "$CAN_DOCKER" = true ]; then
    cat >> "$PHASE2_SCRIPT" << 'PHASE2EOF'
# TIER 1: Docker Desktop
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    DOCKER_AVAILABLE=true; CHROMADB_MODE="docker"
    echo "  ✓ Docker already running" >> "$LOG"
elif ! command -v docker &>/dev/null; then
    brew install --cask docker >> "$LOG" 2>&1 || true
    open -a Docker 2>/dev/null || true
    for i in $(seq 1 30); do
        docker info &>/dev/null 2>&1 && break
        sleep 2
    done
    if docker info &>/dev/null 2>&1; then
        DOCKER_AVAILABLE=true; CHROMADB_MODE="docker"
        echo "  ✓ Docker Desktop installed + running" >> "$LOG"
    fi
fi
PHASE2EOF
fi

if [ "$CAN_COLIMA" = true ]; then
    cat >> "$PHASE2_SCRIPT" << PHASE2EOF
# TIER 1+2: Colima fallback
if [ "\$DOCKER_AVAILABLE" = false ]; then
    command -v colima &>/dev/null || brew install colima docker >> "\$LOG" 2>&1 || true
    if command -v colima &>/dev/null; then
        COLIMA_MEM=$( [ "$RAM_GB" -ge 16 ] && echo 4 || echo 2 )
        colima start --cpu 2 --memory \$COLIMA_MEM --arch $ARCH >> "\$LOG" 2>&1 && {
            DOCKER_AVAILABLE=true; CHROMADB_MODE="docker"
            echo "  ✓ Colima running" >> "\$LOG"
        } || echo "  ⚠ Colima failed" >> "\$LOG"
    fi
fi
PHASE2EOF
fi

cat >> "$PHASE2_SCRIPT" << 'PHASE2EOF'

update_state "services.docker_available" "$DOCKER_AVAILABLE"

# ── 2. Ollama ─────────────────────────────────────────────────────────────
echo "[$(date +%H:%M:%S)] Setting up Ollama..." >> "$LOG"

OLLAMA_AVAILABLE=false

if command -v ollama &>/dev/null; then
    OLLAMA_AVAILABLE=true
    echo "  ✓ Ollama already installed" >> "$LOG"
else
    brew install ollama >> "$LOG" 2>&1 && {
        OLLAMA_AVAILABLE=true
        echo "  ✓ Ollama installed" >> "$LOG"
    } || echo "  ✗ Ollama install failed" >> "$LOG"
fi

if [ "$OLLAMA_AVAILABLE" = true ]; then
    if ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
        brew services start ollama >> "$LOG" 2>&1 || true
        for i in $(seq 1 20); do
            curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null && break
            sleep 1
        done
        if ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
            ollama serve >> "$LOG" 2>&1 &
            sleep 3
        fi
    fi

    if curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
        echo "  ✓ Ollama running on :$OLLAMA_PORT" >> "$LOG"
    else
        echo "  ⚠ Ollama not responding" >> "$LOG"
    fi
fi

update_state "services.ollama_available" "$OLLAMA_AVAILABLE"

# ── 3. Pull Models (parallel) ────────────────────────────────────────────
PHASE2EOF

# Inject selected model
cat >> "$PHASE2_SCRIPT" << PHASE2EOF
SELECTED_MODEL="$SELECTED_MODEL"
MODEL_SIZE="$MODEL_SIZE"
PHASE2EOF

cat >> "$PHASE2_SCRIPT" << 'PHASE2EOF'
echo "[$(date +%H:%M:%S)] Pulling AI models..." >> "$LOG"

if [ "$OLLAMA_AVAILABLE" = true ] && curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    EXISTING=$(ollama list 2>/dev/null || echo "")

    PIDS=()

    if ! echo "$EXISTING" | grep -q "nomic-embed-text"; then
        echo "  → Pulling nomic-embed-text (~270MB)..." >> "$LOG"
        ollama pull nomic-embed-text >> "$LOG" 2>&1 &
        PIDS+=($!)
    else
        echo "  ✓ nomic-embed-text already downloaded" >> "$LOG"
    fi

    if ! echo "$EXISTING" | grep -q "$SELECTED_MODEL"; then
        echo "  → Pulling $SELECTED_MODEL ($MODEL_SIZE)..." >> "$LOG"
        ollama pull "$SELECTED_MODEL" >> "$LOG" 2>&1 &
        PIDS+=($!)
    else
        echo "  ✓ $SELECTED_MODEL already downloaded" >> "$LOG"
    fi

    # Wait for all pulls
    for pid in "${PIDS[@]}"; do
        wait "$pid" || echo "  ⚠ A model pull failed (PID: $pid)" >> "$LOG"
    done

    echo "  ✓ Model pull complete" >> "$LOG"
else
    echo "  ⚠ Ollama not available — skipping model pull" >> "$LOG"
fi

# ── 4. ChromaDB ───────────────────────────────────────────────────────────
echo "[$(date +%H:%M:%S)] Starting ChromaDB..." >> "$LOG"

if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    echo "  ✓ ChromaDB already running" >> "$LOG"
elif [ "$CHROMADB_MODE" = "docker" ] && docker info &>/dev/null 2>&1; then
    docker rm -f chromadb >> "$LOG" 2>&1 || true
    docker run -d \
        --name chromadb \
        --restart unless-stopped \
        -p $CHROMADB_PORT:8000 \
        -v "$MIRRORAI_HOME/data/chromadb:/chroma/chroma" \
        chromadb/chroma:latest >> "$LOG" 2>&1

    for i in $(seq 1 30); do
        curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null && break
        sleep 1
    done

    if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
        echo "  ✓ ChromaDB running (Docker)" >> "$LOG"
    else
        CHROMADB_MODE="pip"
    fi
fi

if [ "$CHROMADB_MODE" = "pip" ] && ! curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    source "$REPO_DIR/.venv/bin/activate" 2>/dev/null || true
    pip install chromadb >> "$LOG" 2>&1 || true
    mkdir -p "$MIRRORAI_HOME/data/chromadb"

    nohup "$REPO_DIR/.venv/bin/chroma" run \
        --path "$MIRRORAI_HOME/data/chromadb" \
        --port $CHROMADB_PORT \
        --host 0.0.0.0 \
        >> "$MIRRORAI_HOME/logs/chromadb.log" 2>&1 &
    CHROMA_PID=$!
    echo "$CHROMA_PID" > "$MIRRORAI_HOME/chromadb.pid"

    for i in $(seq 1 20); do
        curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null && break
        sleep 1
    done

    if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
        echo "  ✓ ChromaDB running (pip, PID: $CHROMA_PID)" >> "$LOG"

        # Auto-start via launchd
        PLIST_DIR="$HOME/Library/LaunchAgents"
        PLIST_FILE="$PLIST_DIR/com.mirrorai.chromadb.plist"
        mkdir -p "$PLIST_DIR"
        cat > "$PLIST_FILE" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mirrorai.chromadb</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO_DIR/.venv/bin/chroma</string>
        <string>run</string>
        <string>--path</string>
        <string>$MIRRORAI_HOME/data/chromadb</string>
        <string>--port</string>
        <string>$CHROMADB_PORT</string>
        <string>--host</string>
        <string>0.0.0.0</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$MIRRORAI_HOME/logs/chromadb.log</string>
    <key>StandardErrorPath</key>
    <string>$MIRRORAI_HOME/logs/chromadb.log</string>
</dict>
</plist>
PLISTEOF
        launchctl load "$PLIST_FILE" 2>/dev/null || true
    else
        echo "  ⚠ ChromaDB failed to start" >> "$LOG"
    fi
fi

update_state "services.chromadb_mode" "\"$CHROMADB_MODE\""

# ── 5. Switch to local mode ───────────────────────────────────────────────
echo "[$(date +%H:%M:%S)] Finalizing..." >> "$LOG"

# Check if local AI is ready
OLLAMA_OK=false
MODELS_OK=false

if curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
    OLLAMA_OK=true
    MODELS=$(ollama list 2>/dev/null || echo "")
    if echo "$MODELS" | grep -q "$SELECTED_MODEL" && echo "$MODELS" | grep -q "nomic-embed-text"; then
        MODELS_OK=true
    fi
fi

if [ "$OLLAMA_OK" = true ] && [ "$MODELS_OK" = true ]; then
    # Switch config to local mode
    python3 -c "
import yaml, sys
config_path = '$MIRRORAI_HOME/mirrorai.config.yaml'
with open(config_path, 'r') as f:
    config = yaml.safe_load(f)
config['model']['primary'] = 'ollama/$SELECTED_MODEL'
config['model']['fallback'] = 'gemini/gemini-2.5-flash'
config['model']['cloud_mode'] = False
with open(config_path, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
" 2>/dev/null || true

    update_state "model.cloud_mode" "false"
    update_state "state" '"READY"'
    update_state "phase2_status" '"complete"'
    echo "  ✓ Switched to LOCAL mode (ollama/$SELECTED_MODEL)" >> "$LOG"
else
    update_state "state" '"CLOUD_READY"'
    update_state "phase2_status" '"partial"'
    echo "  ⚠ Staying in CLOUD mode (some services not ready)" >> "$LOG"
fi

echo "=== Phase 2 Complete: $(date) ===" >> "$LOG"

# ── macOS Notification ────────────────────────────────────────────────────
if [ "$OLLAMA_OK" = true ] && [ "$MODELS_OK" = true ]; then
    osascript -e 'display notification "AI models downloaded! Switched to local mode." with title "🪞 MirrorAI" subtitle "Phase 2 Complete ✅"' 2>/dev/null || true
else
    osascript -e 'display notification "Some services need attention. Run: mirrorai doctor" with title "🪞 MirrorAI" subtitle "Phase 2 Partial ⚠"' 2>/dev/null || true
fi
PHASE2EOF

chmod +x "$PHASE2_SCRIPT"
ok "Phase 2 script generated"

# Launch Phase 2 in background
nohup bash "$PHASE2_SCRIPT" > "$PHASE2_LOG" 2>&1 &
PHASE2_PID=$!
echo "$PHASE2_PID" > "$MIRRORAI_HOME/phase2.pid"
ok "Phase 2 running in background (PID: $PHASE2_PID)"
info "Progress: tail -f $PHASE2_LOG"

# ═══════════════════════════════════════════════════════════════════════════
#  DONE — Phase 1 Complete
# ═══════════════════════════════════════════════════════════════════════════
ELAPSED=$SECONDS
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}${BOLD}⚡ MirrorAI installed! (${MINS}m ${SECS}s)${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${DIM}Hardware${NC}     $ARCH | ${RAM_GB}GB RAM | Apple Silicon: $IS_APPLE_SILICON"
echo -e "  ${DIM}macOS${NC}        $OS_VERSION (Tier $COMPAT_TIER: ${TIER_NAMES[$COMPAT_TIER]})"
echo -e "  ${DIM}AI Model${NC}     $SELECTED_MODEL ($MODEL_SIZE) — ${YELLOW}downloading in background${NC}"
echo -e "  ${DIM}Mode${NC}         ${GREEN}Cloud (now)${NC} → ${CYAN}Local (auto-switch when ready)${NC}"
echo -e "  ${DIM}Time${NC}         ${MINS}m ${SECS}s"
echo -e "  ${DIM}Home${NC}         $MIRRORAI_HOME"
echo -e "  ${DIM}Log${NC}          $LOG"
echo ""
echo -e "  ${BOLD}You can use MirrorAI right now (cloud mode):${NC}"
echo -e "  ${GREEN}1.${NC} mirrorai init                    ${DIM}# Setup wizard${NC}"
echo -e "  ${GREEN}2.${NC} mirrorai ingest --platform=telegram --file=~/Downloads/result.json"
echo -e "  ${GREEN}3.${NC} mirrorai mirror --enable          ${DIM}# Start AI clone${NC}"
echo ""
echo -e "  ${DIM}Background:${NC} Ollama + AI models + ChromaDB installing..."
echo -e "  ${DIM}Progress:${NC}   tail -f $PHASE2_LOG"
echo -e "  ${DIM}Check:${NC}      mirrorai doctor"
echo -e "  ${DIM}When done:${NC}  Auto-switches to local mode + macOS notification"
echo ""

if [ "$USE_CLOUD_LLM" != true ]; then
    echo -e "  ${YELLOW}${BOLD}Tip:${NC} Set GEMINI_API_KEY for cloud mode while models download:"
    echo -e "  ${GREEN}\$${NC} echo 'GEMINI_API_KEY=your-key-here' >> ~/.mirrorai/.env"
    echo -e "  ${DIM}Get free key: https://aistudio.google.com/apikey${NC}"
    echo ""
fi

echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
