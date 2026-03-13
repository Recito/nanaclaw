#!/bin/bash
#
# Post-upgrade script for the memory system upgrade.
# Run this after pulling the latest code (via /update-nanoclaw or git pull).
#
# What it does:
#   1. Installs dependencies (better-sqlite3 in container agent-runner)
#   2. Builds both projects
#   3. Migrates legacy memory/*.md files to SQLite memory.db
#   4. Updates per-group CLAUDE.md files (replaces old file-based memory instructions)
#   5. Rebuilds the container image
#   6. Restarts the service
#
# Usage:
#   bash scripts/post-upgrade-memory.sh              # full upgrade
#   bash scripts/post-upgrade-memory.sh --dry-run    # preview migration only
#   bash scripts/post-upgrade-memory.sh --skip-container  # skip container rebuild
#

set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=false
SKIP_CONTAINER=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-container) SKIP_CONTAINER=true ;;
  esac
done

echo "=== NanoClaw Memory Upgrade ==="
echo "Working directory: $(pwd)"
echo ""

# 1. Install dependencies
echo "--- Step 1: Dependencies ---"
npm install
(cd container/agent-runner && npm install)
echo ""

# 2. Build
echo "--- Step 2: Build ---"
npm run build
(cd container/agent-runner && npm run build)
echo ""

# 3. Migrate memories
echo "--- Step 3: Migrate legacy memories ---"
if [ "$DRY_RUN" = true ]; then
  npx tsx scripts/migrate-memories.ts --dry-run
else
  npx tsx scripts/migrate-memories.ts
fi
echo ""

# 4. Update per-group CLAUDE.md files
echo "--- Step 4: Update per-group CLAUDE.md memory sections ---"
if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would update CLAUDE.md files in groups/*/CLAUDE.md"
else
  npx tsx scripts/update-group-claude-md.ts
fi
echo ""

# 5. Rebuild container
if [ "$SKIP_CONTAINER" = false ] && [ "$DRY_RUN" = false ]; then
  echo "--- Step 5: Rebuild container image ---"
  ./container/build.sh
  echo ""
else
  echo "--- Step 5: Skipped container rebuild ---"
  echo ""
fi

# 6. Restart service
if [ "$DRY_RUN" = false ]; then
  echo "--- Step 6: Restart service ---"
  if [[ "$(uname)" == "Darwin" ]]; then
    if launchctl list | grep -q nanoclaw; then
      launchctl kickstart -k "gui/$(id -u)/com.nanoclaw"
      echo "Service restarted (macOS)"
    else
      echo "No launchd service found — start manually"
    fi
  else
    if systemctl --user is-active nanoclaw &>/dev/null; then
      systemctl --user restart nanoclaw
      echo "Service restarted (Linux)"
    else
      echo "No systemd service found — start manually"
    fi
  fi
  echo ""
fi

echo "=== Memory upgrade complete ==="
echo ""
echo "Test it: send a message like '你记得我是谁吗？' to verify memory recall works."
