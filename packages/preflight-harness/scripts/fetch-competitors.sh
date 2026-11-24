#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Clone salkimos/Stellar-Preflight at the pinned commit into .competitors/ and install ONLY its SDK's dependencies.
# Why a clone: the library is not on npm (verified 404 on 2026-10-31) and its package exports TypeScript source,
# which Node refuses to type-strip inside node_modules.
# Safety: pnpm install runs with --ignore-scripts; nothing from the clone is executed by this script; the harness
# loads packages/sdk/src/index.ts only when a run explicitly selects the stellar-preflight adapter.
# Run it yourself (it needs network); an agent session must not run code it downloaded without your say-so.
# Troubleshooting (seen 2026-11-08 on this machine): if pnpm times out with ETIMEDOUT on registry.npmjs.org while
# `curl -4 https://registry.npmjs.org/` works, IPv6 is unreachable; run
#   NODE_OPTIONS=--dns-result-order=ipv4first scripts/fetch-competitors.sh
set -euo pipefail
cd "$(dirname "$0")/.."
LOCK=scripts/competitors.lock
COMMIT=$(awk -F' *\\| *' '$1=="stellar-preflight"{print $4}' "$LOCK")
DIR=.competitors/Stellar-Preflight
mkdir -p .competitors
if [ ! -d "$DIR/.git" ]; then
  git clone --quiet https://github.com/salkimos/Stellar-Preflight "$DIR"
fi
git -C "$DIR" fetch --quiet origin "$COMMIT" || git -C "$DIR" fetch --quiet origin
git -C "$DIR" checkout --quiet "$COMMIT"
(cd "$DIR" && pnpm install --ignore-scripts --filter @stellar-preflight/sdk...)
echo "ok: $DIR at $COMMIT"
