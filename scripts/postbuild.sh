#!/bin/bash
# GKSetu post-build step (the P-SEC audit fix).
#
# The problem it fixes: package.json's "build" previously chained
#   next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
# unconditionally. On Vercel (and any host running plain `next build`),
# .next/standalone does not exist — next.config.ts deliberately does NOT set
# output: "standalone" ("Vercel manages builds itself", the P1-S1 decision) —
# so the cp failed and took the whole build script down with it.
#
# This script keeps BOTH paths honest:
#  - Vercel / plain `next build`: .next/standalone absent -> exit 0 silently.
#    Vercel serves the standard .next output; nothing to assemble.
#  - The documented sandbox recovery path (scripts/dev-daemon.sh era, the
#    P-SEC session's local-PostgreSQL window): IF .next/standalone exists
#    (e.g. a future output:"standalone" flip), the static assets and public/
#    are assembled into it exactly as before.
set -eu

cd "$(dirname "$0")/.."

if [ -d .next/standalone ]; then
  echo "[postbuild] .next/standalone present — assembling (the recovery path)"
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/
  cp -r public .next/standalone/
  echo "[postbuild] done"
else
  echo "[postbuild] standard next build output — nothing to assemble (Vercel path)"
fi

exit 0
