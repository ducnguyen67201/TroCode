#!/usr/bin/env bash
set -euo pipefail

for forbidden in src/index.ts src/preload.ts src/main services/api/src services/api/scripts; do
  if [[ -e "$forbidden" ]]; then
    echo "Forbidden production backend path remains: $forbidden" >&2
    exit 1
  fi
done

if rg -n '(@openai/agents|@trycua/cua-driver|posthog-node|electron|electron-forge|"pg"|"openai"|"ws")' package.json; then
  echo "A banned backend dependency remains in package.json" >&2
  exit 1
fi
