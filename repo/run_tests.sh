#!/usr/bin/env bash
set -euo pipefail

# RetailOps Console — Docker-based test runner (recommended)
# Usage: ./run_tests.sh
#
# Runs the full Vitest suite inside Docker.
# No local Node install required.

cd "$(dirname "$0")"

if command -v docker &>/dev/null; then
  docker-compose up --build --abort-on-container-exit test
else
  echo "ERROR: Docker not found. Install Docker or run: npm run test" >&2
  exit 1
fi
