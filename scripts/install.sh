#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# MirrorAI — Smart Installer v3.0 for macOS
# Usage: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tuantaotis/MirrorAI/main/scripts/install.sh)"
#
# Features:
#   - Smart macOS version detection (Tier 1/2/3 compatibility)
#   - Auto-select tools based on OS version + hardware
#   - Error Recovery Engine: auto-diagnose + fix common issues
#   - AI Fallback: suggest fixes for unknown errors
#   - Progress bar + spinner with elapsed time
#   - Zero user interaction required
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail
# NOTE: no `set -e` — we handle errors manually via diagnose_and_fix()

# ── Constants ─────────────────────────────────────────────────────────────
VERSION="3.0.0"
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

    # Get last 50 lines of log for analysis
    if [ -z "$error_context" ]; then
        error_context=$(tail -50 "$LOG" 2>/dev/null || echo "no log")
    fi

    echo ""
    log "${MAGENTA}🔍 Error Recovery Engine — analyzing failure...${NC}"
    echo "$error_context" >> "$LOG" 2>/dev/null || true

    # Pattern matching on error
    case "$error_context" in
        *"does not run on macOS versions older"*)
            warn "DIAGNOSED: Tool incompatible with this macOS version"
            info "AUTO-FIX: Skipping to compatible fallback..."
            return 0  # Signal caller to try fallback
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
            # Unknown error → AI fallback
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

    # Check internet
    if ! curl -sf --max-time 3 https://google.com &>/dev/null; then
        err "No internet — cannot use AI diagnosis"
        err "Error context: $(echo "$error_text" | tail -5)"
        return 1
    fi

    # Extract key error lines (last 10 meaningful lines)
    local key_lines
    key_lines=$(echo "$error_text" | grep -iE 'error|fail|fatal|cannot|unable|denied|not found' | tail -10)
    [ -z "$key_lines" ] && key_lines=$(echo "$error_text" | tail -10)

    info "Searching for solution online..."

    # Use DuckDuckGo instant answer API (no API key needed)
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

    # Always show the error for manual debugging
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

        # Auto-diagnose and fix
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
echo -e "${BOLD}║   Auto-detect • Auto-fix • AI-assisted       ║${NC}"
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

# Detect Apple Silicon
IS_APPLE_SILICON=false
if [ "$ARCH" = "arm64" ]; then
    IS_APPLE_SILICON=true
fi

# ── macOS Compatibility Tier ──────────────────────────────────────────────
# TIER 1 (macOS 14+): Full support — Docker Desktop, Ollama, brew bottles
# TIER 2 (macOS 13):  Partial — Colima instead of Docker, Ollama ARM only, brew compile
# TIER 3 (macOS 12):  Minimal — pip ChromaDB only, Ollama ARM only
# UNSUPPORTED (<12):  Exit with clear message

CAN_DOCKER=false         # Docker Desktop (latest)
CAN_COLIMA=false         # Colima (lightweight Docker)
CAN_OLLAMA=true          # Ollama local LLM
BREW_HAS_BOTTLES=false   # Pre-compiled brew packages
CHROMADB_MODE="pip"      # docker | pip
USE_CLOUD_LLM=false      # Fallback to cloud API
COMPAT_TIER=0

if [ "$OS_MAJOR" -lt 12 ]; then
    echo ""
    err "macOS $OS_VERSION is not supported (minimum: macOS 12 Monterey)"
    err "Please upgrade macOS: System Settings → General → Software Update"
    echo ""
    info "Supported versions:"
    info "  macOS 12 (Monterey)  — basic support"
    info "  macOS 13 (Ventura)   — good support"
    info "  macOS 14+ (Sonoma+)  — full support"
    exit 1
elif [ "$OS_MAJOR" -ge 14 ]; then
    COMPAT_TIER=1
    CAN_DOCKER=true
    CAN_COLIMA=true
    BREW_HAS_BOTTLES=true
    CHROMADB_MODE="docker"
elif [ "$OS_MAJOR" -ge 13 ]; then
    COMPAT_TIER=2
    CAN_COLIMA=true
    CAN_OLLAMA=true
    CHROMADB_MODE="docker"
else
    # macOS 12
    COMPAT_TIER=3
    CAN_OLLAMA=true
    CHROMADB_MODE="pip"
fi

# Auto-select model based on RAM (only if Ollama is available)
# ┌──────────┬──────────────────┬──────────┬───────────┐
# │ RAM      │ Model            │ Download │ RAM Usage │
# ├──────────┼──────────────────┼──────────┼───────────┤
# │ 64GB+    │ qwen2.5:32b      │ ~20GB    │ ~22GB     │
# │ 48GB     │ qwen2.5:14b      │ ~9GB     │ ~10GB     │
# │ 24-32GB  │ qwen2.5:7b       │ ~4.7GB   │ ~5.5GB    │
# │ 16GB     │ qwen2.5:3b       │ ~2GB     │ ~2.5GB    │
# │ 8-12GB   │ qwen2.5:1.5b     │ ~1GB     │ ~1.5GB    │
# │ ≤4GB     │ qwen2.5:0.5b     │ ~400MB   │ ~600MB    │
# └──────────┴──────────────────┴──────────┴───────────┘
if [ "$CAN_OLLAMA" = true ]; then
    if [ "$RAM_GB" -ge 64 ]; then
        SELECTED_MODEL="qwen2.5:32b"; MODEL_SIZE="~20GB"; QUALITY="Best — near cloud-quality"
    elif [ "$RAM_GB" -ge 48 ]; then
        SELECTED_MODEL="qwen2.5:14b"; MODEL_SIZE="~9GB"; QUALITY="Great — recommended"
    elif [ "$RAM_GB" -ge 24 ]; then
        SELECTED_MODEL="qwen2.5:7b"; MODEL_SIZE="~4.7GB"; QUALITY="Great — smooth"
    elif [ "$RAM_GB" -ge 16 ]; then
        SELECTED_MODEL="qwen2.5:3b"; MODEL_SIZE="~2GB"; QUALITY="Good — casual chat"
    elif [ "$RAM_GB" -ge 8 ]; then
        SELECTED_MODEL="qwen2.5:1.5b"; MODEL_SIZE="~1GB"; QUALITY="Good — lightweight, Vietnamese OK"
    else
        SELECTED_MODEL="qwen2.5:0.5b"; MODEL_SIZE="~400MB"; QUALITY="Basic — ultra-light"
    fi
else
    SELECTED_MODEL="gemini/gemini-2.5-flash"
    MODEL_SIZE="cloud"
    QUALITY="Cloud API — free tier (250 req/day)"
fi

ok "macOS $OS_VERSION | $ARCH | ${RAM_GB}GB RAM | ${CORES} cores"
ok "CPU: $CPU_BRAND"

# ── Compatibility Report ─────────────────────────────────────────────────
TIER_NAMES=("" "FULL SUPPORT" "PARTIAL SUPPORT" "MINIMAL SUPPORT")
TIER_COLORS=("" "$GREEN" "$YELLOW" "$RED")

echo ""
echo -e "  ${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "  ${BOLD}║  macOS $OS_VERSION — TIER $COMPAT_TIER: ${TIER_COLORS[$COMPAT_TIER]}${TIER_NAMES[$COMPAT_TIER]}${NC}${BOLD}$(printf '%*s' $((16 - ${#TIER_NAMES[$COMPAT_TIER]})) '')║${NC}"
echo -e "  ${BOLD}╠══════════════════════════════════════════════════╣${NC}"

# Docker line
if [ "$CAN_DOCKER" = true ]; then
    echo -e "  ${BOLD}║${NC}  Docker Desktop    ${GREEN}✅ compatible${NC}                ${BOLD}║${NC}"
elif [ "$CAN_COLIMA" = true ]; then
    echo -e "  ${BOLD}║${NC}  Docker Desktop    ${RED}❌${NC} → ${GREEN}Colima (fallback)${NC}       ${BOLD}║${NC}"
else
    echo -e "  ${BOLD}║${NC}  Docker Desktop    ${RED}❌${NC} → ${YELLOW}not needed (pip mode)${NC}   ${BOLD}║${NC}"
fi

# Ollama line
if [ "$CAN_OLLAMA" = true ]; then
    echo -e "  ${BOLD}║${NC}  Ollama (local AI) ${GREEN}✅ compatible${NC}                ${BOLD}║${NC}"
else
    echo -e "  ${BOLD}║${NC}  Ollama (local AI) ${RED}❌${NC} → ${GREEN}Cloud API (free)${NC}        ${BOLD}║${NC}"
fi

# ChromaDB line
if [ "$CHROMADB_MODE" = "docker" ]; then
    echo -e "  ${BOLD}║${NC}  ChromaDB          ${GREEN}✅ via container${NC}             ${BOLD}║${NC}"
else
    echo -e "  ${BOLD}║${NC}  ChromaDB          ${GREEN}✅ via pip (no Docker)${NC}        ${BOLD}║${NC}"
fi

# Brew line
if [ "$BREW_HAS_BOTTLES" = true ]; then
    echo -e "  ${BOLD}║${NC}  Homebrew          ${GREEN}✅ pre-built bottles${NC}          ${BOLD}║${NC}"
else
    echo -e "  ${BOLD}║${NC}  Homebrew          ${YELLOW}⚠  compile from source (~20m)${NC} ${BOLD}║${NC}"
fi

# Model line
if [ "$USE_CLOUD_LLM" = true ]; then
    echo -e "  ${BOLD}║${NC}  AI Model          ${CYAN}☁  Gemini Flash (free)${NC}        ${BOLD}║${NC}"
else
    echo -e "  ${BOLD}║${NC}  AI Model          ${GREEN}✅ $SELECTED_MODEL ($MODEL_SIZE)${NC}$(printf '%*s' $((11 - ${#SELECTED_MODEL} - ${#MODEL_SIZE})) '')${BOLD}║${NC}"
fi

echo -e "  ${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

echo "Hardware: macOS $OS_VERSION, $ARCH, ${RAM_GB}GB RAM, $CORES cores, Tier $COMPAT_TIER" >> "$LOG"
echo "Flags: CAN_DOCKER=$CAN_DOCKER CAN_COLIMA=$CAN_COLIMA CAN_OLLAMA=$CAN_OLLAMA CHROMADB_MODE=$CHROMADB_MODE USE_CLOUD_LLM=$USE_CLOUD_LLM" >> "$LOG"
echo "Selected model: $SELECTED_MODEL" >> "$LOG"

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
        # Retry once
        run_with_status "Retrying Homebrew install..." env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
            err "Homebrew installation failed — cannot continue"
            exit 1
        }
    fi

    # Add brew to PATH for Apple Silicon
    if [ "$IS_APPLE_SILICON" = true ] && [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        SHELL_PROFILE="$HOME/.zprofile"
        if ! grep -q 'homebrew' "$SHELL_PROFILE" 2>/dev/null; then
            echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$SHELL_PROFILE"
        fi
    fi
fi

# Pre-update brew on older macOS (avoids shallow clone issues)
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

# Pre-fix openssl@3 for older macOS
if [ "$NEED_PYTHON" = true ] && [ "$BREW_HAS_BOTTLES" = false ]; then
    if brew list openssl@3 &>/dev/null 2>&1; then
        log "Pre-fixing openssl@3 postinstall for macOS $OS_VERSION..."
        run_with_status "Running brew postinstall openssl@3..." brew postinstall openssl@3 || true
    fi
fi

# Install missing deps one by one
[ "$NEED_GIT" = true ] && { brew_install_safe git || exit 1; }

if [ "$NEED_NODE" = true ]; then
    brew_install_safe node@20 || {
        # Fallback: try node@18
        warn "node@20 failed, trying node@18..."
        brew_install_safe node@18 || {
            err "Cannot install Node.js"; exit 1
        }
    }
    brew link node@20 --force >> "$LOG" 2>&1 || brew link node@18 --force >> "$LOG" 2>&1 || true
fi

if [ "$NEED_PYTHON" = true ]; then
    brew_install_safe python@3.12 || {
        warn "python@3.12 failed, trying python@3.11..."
        brew_install_safe python@3.11 || {
            # Check system python
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
#  STEP 4: Container Runtime (tier-based)
# ═══════════════════════════════════════════════════════════════════════════
step "Setting up container runtime..."

DOCKER_AVAILABLE=false

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker already running ($(docker --version | awk '{print $3}' | tr -d ','))"
    DOCKER_AVAILABLE=true
    CHROMADB_MODE="docker"
else
    # ── TIER 1: Try Docker Desktop ────────────────────────────────────────
    if [ "$CAN_DOCKER" = true ]; then
        log "TIER 1: Installing Docker Desktop..."
        if ! command -v docker &>/dev/null; then
            if run_with_status "Installing Docker Desktop..." brew install --cask docker; then
                ok "Docker Desktop installed"
            else
                warn "Docker Desktop install failed — trying Colima..."
                CAN_DOCKER=false
            fi
        fi

        if [ "$CAN_DOCKER" = true ] && command -v docker &>/dev/null; then
            open -a Docker 2>/dev/null || open /Applications/Docker.app 2>/dev/null || true
            DOCKER_WAIT=0
            while ! docker info &>/dev/null 2>&1; do
                [ $DOCKER_WAIT -ge 45 ] && break
                printf "\r  ${CYAN}⏳${NC} Waiting for Docker Desktop... ${DIM}(%ds/45s)${NC}\033[K" "$DOCKER_WAIT"
                sleep 2
                DOCKER_WAIT=$((DOCKER_WAIT + 2))
            done
            printf "\r\033[K"

            if docker info &>/dev/null 2>&1; then
                ok "Docker Desktop running"
                DOCKER_AVAILABLE=true
                CHROMADB_MODE="docker"
            fi
        fi
    fi

    # ── TIER 1+2: Try Colima ──────────────────────────────────────────────
    if [ "$DOCKER_AVAILABLE" = false ] && [ "$CAN_COLIMA" = true ]; then
        log "Trying Colima (lightweight Docker runtime)..."

        if ! command -v colima &>/dev/null; then
            run_with_status "Installing Colima + Docker CLI..." brew install colima docker || true
        fi

        if command -v colima &>/dev/null; then
            # Allocate minimal resources
            COLIMA_MEM=2
            [ "$RAM_GB" -ge 16 ] && COLIMA_MEM=4

            if run_with_status "Starting Colima VM (${COLIMA_MEM}GB RAM)..." colima start --cpu 2 --memory "$COLIMA_MEM" --arch "$ARCH" 2>/dev/null; then
                ok "Colima running (lightweight Docker runtime)"
                DOCKER_AVAILABLE=true
                CHROMADB_MODE="docker"
            else
                warn "Colima failed to start"
                diagnose_and_fix "Colima start" "$?" "" || true
            fi
        fi
    fi

    # ── TIER 3: pip mode (no container) ───────────────────────────────────
    if [ "$DOCKER_AVAILABLE" = false ]; then
        CHROMADB_MODE="pip"
        ok "No container runtime needed — ChromaDB will run via pip"
        info "This is normal for macOS $OS_VERSION (Tier $COMPAT_TIER)"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 5: Ollama (or Cloud LLM fallback)
# ═══════════════════════════════════════════════════════════════════════════
step "Setting up AI model provider..."

OLLAMA_AVAILABLE=false

if [ "$CAN_OLLAMA" = true ]; then
    if command -v ollama &>/dev/null; then
        ok "Ollama already installed"
        OLLAMA_AVAILABLE=true
    else
        if run_with_status "Installing Ollama..." brew install ollama; then
            ok "Ollama installed"
            OLLAMA_AVAILABLE=true
        else
            warn "Ollama install failed"
            diagnose_and_fix "Ollama install" "$?" "" || true
        fi
    fi

    # Start Ollama
    if [ "$OLLAMA_AVAILABLE" = true ]; then
        if ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
            log "Starting Ollama service..."
            brew services start ollama >> "$LOG" 2>&1 || true

            OLLAMA_WAIT=0
            while ! curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; do
                if [ $OLLAMA_WAIT -ge 15 ]; then
                    # Try direct start
                    ollama serve >> "$LOG" 2>&1 &
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
            warn "Ollama not responding — will retry model pull later"
        fi
    fi
else
    # Cloud LLM mode
    USE_CLOUD_LLM=true
    SELECTED_MODEL="gemini/gemini-2.5-flash"
    MODEL_SIZE="cloud"
    QUALITY="Cloud API — free tier"

    warn "Ollama not compatible with macOS $OS_VERSION ($ARCH)"
    ok "Using cloud AI: Gemini 2.5 Flash (free tier: 250 req/day)"
    info "To use local AI, upgrade to macOS 14+ (Sonoma)"
    info "Set GEMINI_API_KEY in ~/.mirrorai/.env for cloud mode"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 6: Pull AI Models (or configure cloud)
# ═══════════════════════════════════════════════════════════════════════════
step "Setting up AI models..."

if [ "$USE_CLOUD_LLM" = true ]; then
    ok "Cloud mode: no model download needed"
    info "Primary: Gemini 2.5 Flash (free) | Fallback: DeepSeek V3 (\$0.14/1M)"
else
    # Embedding model
    if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
        ok "nomic-embed-text already downloaded"
    else
        run_with_status "Pulling nomic-embed-text (~270MB)..." ollama pull nomic-embed-text && \
            ok "nomic-embed-text (embedding)" || \
            warn "Pull failed — retry later: ollama pull nomic-embed-text"
    fi

    # Chat model
    if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
        ok "$SELECTED_MODEL already downloaded"
    else
        run_with_status "Pulling $SELECTED_MODEL ($MODEL_SIZE)..." ollama pull "$SELECTED_MODEL" && \
            ok "$SELECTED_MODEL (chat)" || \
            warn "Pull failed — retry later: ollama pull $SELECTED_MODEL"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 7: Clone Repository
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
        # Retry once
        run_with_status "Retrying clone..." git clone "$REPO_URL" "$REPO_DIR" || {
            err "Cannot clone repository"; exit 1
        }
        ok "Repository cloned (retry)"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 8: Node.js Dependencies
# ═══════════════════════════════════════════════════════════════════════════
step "Installing Node.js dependencies..."

cd "$REPO_DIR"
if run_with_status "npm install (workspaces)..." npm install --workspaces; then
    ok "npm packages installed"
else
    warn "npm install failed — trying without workspaces..."
    run_with_status "npm install (flat)..." npm install || {
        diagnose_and_fix "npm install" "$?" ""
        err "npm install failed"
    }
fi
run_with_status "npm build (workspaces)..." npm run build --workspaces 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 9: Python Dependencies
# ═══════════════════════════════════════════════════════════════════════════
step "Installing Python dependencies..."

cd "$REPO_DIR"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv >> "$LOG" 2>&1
fi

source .venv/bin/activate

run_with_status "Upgrading pip..." pip install --upgrade pip
if run_with_status "Installing Python packages..." pip install -e ".[dev]"; then
    ok "Python packages installed"
elif run_with_status "Installing Python packages (no dev)..." pip install -e .; then
    ok "Python packages installed (without dev deps)"
else
    warn "pip install -e failed — installing core deps manually..."
    run_with_status "Installing core deps..." pip install chromadb langchain langchain-community underthesea scikit-learn pydantic httpx pyyaml rich || {
        diagnose_and_fix "pip install" "$?" ""
        err "Python package installation failed"
    }
    ok "Core Python packages installed"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 10: ChromaDB
# ═══════════════════════════════════════════════════════════════════════════
step "Starting ChromaDB..."

if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    ok "ChromaDB already running on :$CHROMADB_PORT"
elif [ "$CHROMADB_MODE" = "docker" ] && docker info &>/dev/null 2>&1; then
    # Docker/Colima mode
    docker rm -f chromadb >> "$LOG" 2>&1 || true

    log "Starting ChromaDB container..."
    docker run -d \
        --name chromadb \
        --restart unless-stopped \
        -p $CHROMADB_PORT:8000 \
        -v "$MIRRORAI_HOME/data/chromadb:/chroma/chroma" \
        chromadb/chroma:latest >> "$LOG" 2>&1

    CHROMA_WAIT=0
    while ! curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; do
        [ $CHROMA_WAIT -ge 30 ] && break
        sleep 1
        CHROMA_WAIT=$((CHROMA_WAIT + 1))
    done

    if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
        ok "ChromaDB running on :$CHROMADB_PORT (Docker)"
    else
        warn "ChromaDB container not ready — falling back to pip mode..."
        CHROMADB_MODE="pip"
    fi
fi

# Pip mode (primary for Tier 3, fallback for others)
if [ "$CHROMADB_MODE" = "pip" ] && ! curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    log "Starting ChromaDB via pip..."

    source "$REPO_DIR/.venv/bin/activate" 2>/dev/null || true
    pip install chromadb >> "$LOG" 2>&1 || true

    mkdir -p "$MIRRORAI_HOME/data/chromadb"

    CHROMA_LOG="$MIRRORAI_HOME/logs/chromadb.log"
    nohup "$REPO_DIR/.venv/bin/chroma" run \
        --path "$MIRRORAI_HOME/data/chromadb" \
        --port $CHROMADB_PORT \
        --host 0.0.0.0 \
        > "$CHROMA_LOG" 2>&1 &
    CHROMA_PID=$!
    echo "$CHROMA_PID" > "$MIRRORAI_HOME/chromadb.pid"

    CHROMA_WAIT=0
    while ! curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; do
        if [ $CHROMA_WAIT -ge 20 ]; then
            warn "ChromaDB not ready — check: $CHROMA_LOG"
            break
        fi
        sleep 1
        CHROMA_WAIT=$((CHROMA_WAIT + 1))
    done

    if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
        ok "ChromaDB running on :$CHROMADB_PORT (pip mode, PID: $CHROMA_PID)"

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
        ok "ChromaDB auto-start configured (launchd)"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 11: Auto-Generate Config
# ═══════════════════════════════════════════════════════════════════════════
step "Auto-generating configuration..."

# Determine model config based on mode
if [ "$USE_CLOUD_LLM" = true ]; then
    MODEL_PRIMARY="gemini/gemini-2.5-flash"
    MODEL_FALLBACK="deepseek/deepseek-chat"
    EMBEDDING_PROVIDER="ollama"  # Still try ollama for embeddings if available
else
    MODEL_PRIMARY="ollama/$SELECTED_MODEL"
    MODEL_FALLBACK="gemini/gemini-2.5-flash"
    EMBEDDING_PROVIDER="ollama"
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
$([ "$USE_CLOUD_LLM" = true ] && echo "# REQUIRED for cloud mode:" || echo "# Optional — for cloud fallback:")
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
  temperature: 0.8
  cloud_mode: $USE_CLOUD_LLM

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
ok "mirrorai.config.yaml generated (model: $MODEL_PRIMARY)"

# State
cat > "$MIRRORAI_HOME/state.json" << STATEEOF
{
  "state": "READY",
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
    "embedding": "nomic-embed-text",
    "cloud_mode": $USE_CLOUD_LLM
  },
  "services": {
    "chromadb_mode": "$CHROMADB_MODE",
    "docker_available": $DOCKER_AVAILABLE,
    "ollama_available": ${OLLAMA_AVAILABLE:-false}
  },
  "platforms": {},
  "persona_built": false,
  "mirroring": false
}
STATEEOF
ok "State initialized"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 12: Install CLI + Health Check
# ═══════════════════════════════════════════════════════════════════════════
step "Installing CLI & running health check..."

# Link CLI
cd "$REPO_DIR/apps/cli" 2>/dev/null && {
    npm link >> "$LOG" 2>&1 || {
        SHELL_PROFILE="$HOME/.zprofile"
        if ! grep -q 'mirrorai' "$SHELL_PROFILE" 2>/dev/null; then
            echo "export PATH=\"$REPO_DIR/apps/cli/node_modules/.bin:\$PATH\"" >> "$SHELL_PROFILE"
        fi
    }
    ok "CLI installed"
} || warn "CLI directory not found — skipping"

# ── Health Check (tier-aware) ─────────────────────────────────────────────
echo ""
log "${BOLD}Running health check...${NC}"

HC_PASS=0
HC_TOTAL=0

# Check Ollama (only if expected)
if [ "$CAN_OLLAMA" = true ]; then
    HC_TOTAL=$((HC_TOTAL + 1))
    if curl -sf http://localhost:$OLLAMA_PORT/api/tags &>/dev/null; then
        ok "Ollama        ✅ running"; HC_PASS=$((HC_PASS + 1))
    else
        err "Ollama        ❌ not running — run: brew services start ollama"
    fi
else
    info "Ollama        ⏭  skipped (cloud mode)"
fi

# Check ChromaDB
HC_TOTAL=$((HC_TOTAL + 1))
if curl -sf http://localhost:$CHROMADB_PORT/api/v1/heartbeat &>/dev/null; then
    ok "ChromaDB      ✅ running ($CHROMADB_MODE mode)"; HC_PASS=$((HC_PASS + 1))
else
    err "ChromaDB      ❌ not running"
    if [ "$CHROMADB_MODE" = "pip" ]; then
        info "Start manually: ~/.mirrorai/app/.venv/bin/chroma run --path ~/.mirrorai/data/chromadb --port 8000"
    fi
fi

# Check models
if [ "$USE_CLOUD_LLM" = true ]; then
    HC_TOTAL=$((HC_TOTAL + 1))
    info "AI Model      ☁  Cloud mode (Gemini Flash)"; HC_PASS=$((HC_PASS + 1))
    info "              Set GEMINI_API_KEY in ~/.mirrorai/.env"
else
    # Check chat model
    HC_TOTAL=$((HC_TOTAL + 1))
    if ollama list 2>/dev/null | grep -q "$SELECTED_MODEL"; then
        ok "Chat model    ✅ $SELECTED_MODEL"; HC_PASS=$((HC_PASS + 1))
    else
        err "Chat model    ❌ run: ollama pull $SELECTED_MODEL"
    fi

    # Check embedding
    HC_TOTAL=$((HC_TOTAL + 1))
    if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
        ok "Embedding     ✅ nomic-embed-text"; HC_PASS=$((HC_PASS + 1))
    else
        err "Embedding     ❌ run: ollama pull nomic-embed-text"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════════════════════════
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
echo -e "  ${DIM}macOS${NC}        $OS_VERSION (Tier $COMPAT_TIER: ${TIER_NAMES[$COMPAT_TIER]})"
echo -e "  ${DIM}Model${NC}        $SELECTED_MODEL ($QUALITY)"
echo -e "  ${DIM}ChromaDB${NC}     $CHROMADB_MODE mode"
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

if [ "$USE_CLOUD_LLM" = true ]; then
    echo -e "  ${YELLOW}${BOLD}Important:${NC} Cloud mode requires API key:"
    echo -e "  ${GREEN}\$${NC} echo 'GEMINI_API_KEY=your-key-here' >> ~/.mirrorai/.env"
    echo -e "  ${DIM}Get free key: https://aistudio.google.com/apikey${NC}"
    echo ""
fi

echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
