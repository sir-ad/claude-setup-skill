#!/bin/sh
# Install or update the /claude-setup skill by symlinking this repo into ~/.claude/skills/.
#
# Usage:
#   ./install.sh              install (or update) the symlink
#   ./install.sh --force      overwrite an existing non-symlink target
#   ./install.sh --uninstall  remove the symlink
#   ./install.sh --help       show usage
#
# Written for POSIX sh. Do not add bashisms ([[ ]], arrays, BASH_SOURCE).
set -eu

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
TARGET="$SKILLS_DIR/claude-setup"

usage() {
    cat <<EOF
Usage: ./install.sh [--force | --uninstall | --help]

  (no flag)     create or refresh symlink: $TARGET -> $REPO_ROOT
  --force       replace an existing dir/file at the target
  --uninstall   remove the symlink (does not touch this repo)
  -h, --help    show this message
EOF
}

MODE=install
FORCE=0
for arg in "$@"; do
    case "$arg" in
        -h|--help)
            usage
            exit 0
            ;;
        --uninstall)
            MODE=uninstall
            ;;
        --force)
            FORCE=1
            ;;
        *)
            echo "error: unknown option: $arg" >&2
            usage >&2
            exit 2
            ;;
    esac
done

mkdir -p "$SKILLS_DIR"

if [ "$MODE" = uninstall ]; then
    if [ -L "$TARGET" ]; then
        rm "$TARGET"
        echo "removed: $TARGET"
    else
        echo "no symlink at $TARGET; nothing to do"
    fi
    exit 0
fi

# Refuse to clobber a real directory unless --force.
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
    if [ "$FORCE" -ne 1 ]; then
        echo "error: $TARGET exists and is not a symlink. Use --force to replace." >&2
        exit 1
    fi
    echo "warning: removing existing $TARGET (--force)"
    rm -rf "$TARGET"
fi

# Refresh symlink.
if [ -L "$TARGET" ]; then
    rm "$TARGET"
fi

ln -s "$REPO_ROOT" "$TARGET"

echo "installed: $TARGET -> $REPO_ROOT"
echo ""
echo "Try it:"
echo "  cd <some-project>"
echo "  claude    # then type:"
echo "  /claude-setup"
