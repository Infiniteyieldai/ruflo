#!/usr/bin/env bash
# fork-sync.sh — Sync all Infiniteyieldai forks with their upstreams
# Usage: bash scripts/fork-sync.sh [--org ORG] [--report] [--dry-run]

set -euo pipefail

ORG="Infiniteyieldai"
REPORT=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --org) ORG="$2"; shift 2 ;;
    --report) REPORT=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

# Check auth
if ! gh auth status &>/dev/null; then
  echo "ERROR: Not authenticated. Run: gh auth login"
  exit 1
fi

echo "=== Fork Sync: $ORG ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Forks that should be kept in sync (repo:upstream pairs)
declare -A FORKS=(
  ["github-mcp-server"]="github/github-mcp-server"
  ["claude-code-templates"]="davila7/claude-code-templates"
  ["skills"]="remotion-dev/skills"
  ["awesome-claude-skills"]="ComposioHQ/awesome-claude-skills"
  ["public-apis"]="public-apis/public-apis"
  ["n8n-workflows-directory"]="Zie619/n8n-workflows"
  ["skill-builder"]="metaskills/skill-builder"
  ["n8n-claude-code-guide"]="theNetworkChuck/n8n-claude-code-guide"
  ["compound-interest-site"]="shlomsh/compound-interest-site"
  ["cc-nano-banana"]="kkoppenhaver/cc-nano-banana"
  ["awesome-nano-banana-pro-prompts"]="YouMind-OpenLab/awesome-nano-banana-pro-prompts"
  ["ruflo"]="ruvnet/ruflo"
)

SYNCED=()
FAILED=()
SKIPPED=()

for REPO in "${!FORKS[@]}"; do
  UPSTREAM="${FORKS[$REPO]}"
  FULL_REPO="$ORG/$REPO"

  # Check if repo exists in org
  if ! gh repo view "$FULL_REPO" &>/dev/null; then
    SKIPPED+=("$REPO (not found in org)")
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] Would sync $FULL_REPO from $UPSTREAM"
    SYNCED+=("$REPO")
    continue
  fi

  echo -n "  Syncing $REPO from $UPSTREAM ... "
  if gh repo sync "$FULL_REPO" --source "$UPSTREAM" 2>/dev/null; then
    echo "OK"
    SYNCED+=("$REPO")
  else
    echo "FAILED"
    FAILED+=("$REPO")
  fi
done

echo ""
echo "=== Results ==="
echo "  Synced:  ${#SYNCED[@]} repos"
echo "  Failed:  ${#FAILED[@]} repos"
echo "  Skipped: ${#SKIPPED[@]} repos"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  echo "Failed repos:"
  for r in "${FAILED[@]}"; do echo "  - $r"; done
fi

if [[ "$REPORT" == "true" ]]; then
  REPORT_FILE="/tmp/fork-sync-report-$(date +%Y%m%d).txt"
  {
    echo "Fork Sync Report — $(date -u)"
    echo "Org: $ORG"
    echo "Synced: ${SYNCED[*]:-none}"
    echo "Failed: ${FAILED[*]:-none}"
    echo "Skipped: ${SKIPPED[*]:-none}"
  } > "$REPORT_FILE"
  echo ""
  echo "Report written to $REPORT_FILE"
fi

[[ ${#FAILED[@]} -eq 0 ]]
