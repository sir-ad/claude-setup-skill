#!/usr/bin/env bash
# Install or update the /claude-setup skill by symlinking this repo into ~/.claude/skills/.
#
# Usage:
#   ./install.sh            install (or update) the symlink
#   ./install.sh --force    overwrite an existing non-symlink target
#   ./install.sh --uninstall remove the symlink
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
TARGET="$SKILLS_DIR/claude-setup"

usage() {
    cat <<EOF
Usage: ./install.sh [--force | --uninstall]

  (no flag)     create or refresh symlink: $TARGET -> $REPO_ROOT
  --force       replace an existing dir/file at the target
  --uninstall   remove the symlink (does not touch this repo)
EOF
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
esac

mkdir -p "$SKILLS_DIR"

if [[ "${1:-}" == "--uninstall" ]]; then
    if [[ -L "$TARGET" ]]; then
        rm "$TARGET"
        echo "removed: $TARGET"
    else
        echo "no symlink at $TARGET; nothing to do"
    fi
    exit 0
fi

# Refuse to clobber a real directory unless --force.
if [[ -e "$TARGET" && ! -L "$TARGET" ]]; then
    if [[ "${1:-}" != "--force" ]]; then
        echo "error: $TARGET exists and is not a symlink. Use --force to replace." >&2
        exit 1
    fi
    echo "warning: removing existing $TARGET (--force)"
    rm -rf "$TARGET"
fi

# Refresh symlink.
if [[ -L "$TARGET" ]]; then
    rm "$TARGET"
fi

ln -s "$REPO_ROOT" "$TARGET"

echo "installed: $TARGET -> $REPO_ROOT"
echo ""
echo "Try it:"
echo "  cd <some-project>"
echo "  claude    # then type:"
echo "  /claude-setup"
