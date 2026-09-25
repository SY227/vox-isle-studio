#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo '請先安裝 Node.js 22 或更新版本。'; exit 1; }
if [[ ! -f .env ]]; then node scripts/setup.mjs; fi
exec node server/index.mjs
