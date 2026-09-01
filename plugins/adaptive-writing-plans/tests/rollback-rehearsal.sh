#!/bin/bash
set -euo pipefail

# Rollback rehearsal script for N-006
# Tests that the pre-v0.3.0 backup can be restored

BACKUP_DIR="/mnt/data4/zhangzixing/plugins"
PLUGIN_DIR="/mnt/data4/zhangzixing/plugins/adaptive-writing-plans"
TEMP_TEST_DIR="/tmp/rollback-rehearsal-$$"

echo "=== Rollback Rehearsal ==="
echo

# Find the most recent backup
BACKUP_FILE=$(ls -t "$BACKUP_DIR"/adaptive-writing-plans-pre-v0.3.0-backup-*.tar.gz 2>/dev/null | head -1)

if [[ -z "$BACKUP_FILE" ]]; then
  echo "❌ No backup file found in $BACKUP_DIR"
  exit 1
fi

echo "✓ Found backup: $(basename "$BACKUP_FILE")"
echo

# Create temp directory for rehearsal
mkdir -p "$TEMP_TEST_DIR"
echo "✓ Created test directory: $TEMP_TEST_DIR"
echo

# Extract backup to temp location
cd "$TEMP_TEST_DIR"
tar -xzf "$BACKUP_FILE"
echo "✓ Extracted backup successfully"
echo

# Verify critical files exist
CRITICAL_FILES=(
  "adaptive-writing-plans/mcp/server.mjs"
  "adaptive-writing-plans/.mcp.json"
  "adaptive-writing-plans/package.json"
  "adaptive-writing-plans/.codex-plugin/plugin.json"
)

echo "Checking critical files..."
for file in "${CRITICAL_FILES[@]}"; do
  if [[ -f "$file" ]]; then
    echo "  ✓ $file"
  else
    echo "  ❌ Missing: $file"
    exit 1
  fi
done
echo

# Verify package.json has correct structure
if grep -q '"name".*adaptive-writing-plans' adaptive-writing-plans/package.json; then
  echo "✓ package.json structure is valid"
else
  echo "❌ package.json structure is invalid"
  exit 1
fi
echo

# Cleanup
cd /
rm -rf "$TEMP_TEST_DIR"
echo "✓ Cleaned up test directory"
echo

echo "=== Rollback Rehearsal Complete ==="
echo "✅ Backup is valid and can be restored"
echo
echo "To perform actual rollback:"
echo "  1. Stop any running sessions using the plugin"
echo "  2. mv $PLUGIN_DIR ${PLUGIN_DIR}.new"
echo "  3. tar -xzf $BACKUP_FILE -C $BACKUP_DIR"
echo "  4. Verify the old version works"
echo "  5. If needed, rm -rf ${PLUGIN_DIR}.new"
