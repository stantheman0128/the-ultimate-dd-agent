#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "${0:A:h}/.."
export QLIST_MOCK=0
export CODEX_BIN="${CODEX_BIN:-$HOME/.local/bin/codex}"
export PYTHON_BIN="$PWD/.venv/bin/python"
exec node _workbench/server.js
