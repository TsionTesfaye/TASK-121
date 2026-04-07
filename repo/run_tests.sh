#!/usr/bin/env bash
set -euo pipefail

# RetailOps Console — test runner
# Usage: ./run_tests.sh
# Runs the full Vitest suite (unit, integration, simulation, E2E, component).

cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Node 18 LTS is required." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi

npm run test
