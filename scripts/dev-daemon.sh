#!/bin/bash
# GKSetu dev daemon — detached, self-healing dev server (the documented
# P5-S3/P9-S3-followup pattern: a supervisor loop that survives tool-call
# exits and respawns `next dev` whenever the port goes idle).
#
# INDIA-CORPUS ADDITION — the prewarm loop: the public payloads (homepage,
# exam directory, exam pages, sitemap census) carry a 60s in-memory TTL
# (§29, src/lib/payload-cache.ts). On a low-latency deploy the uncached walk
# is milliseconds; from a high-latency sandbox (transaction pooler, ~0.7s
# per query) it is 5-15s — so the daemon re-fetches the hot surfaces every
# 45s to keep the TTLs warm and the preview snappy. Curl failures are
# ignored (the server may be recompiling mid-edit).
#
# Start (idempotent — a live listener on :3000 is left alone):
#   python3 scripts/dev-spawn.py   (double-forked; survives tool-call exits)
cd /home/z/my-project
export NODE_ENV=development

mark() { echo "[daemon] $(date -u +%FT%TZ) $*" >> /home/z/my-project/dev.log; }

prewarm() {
  for path in \
    "/api/home?country=IN" \
    "/api/home?country=FR" \
    "/api/exams?country=IN&pageSize=300" \
    "/sitemap.xml"; do
    curl -s -m 40 -o /dev/null "http://127.0.0.1:3000${path}" 2>/dev/null || true
  done
}

mark "supervisor started (pid $$)"

prewarm_after=0
while true; do
  # Is anything already serving on :3000? (000 = nothing reachable)
  code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$code" = "000" ]; then
    mark "port 3000 idle — spawning dev server"
    bun run dev &
    pid=$!
    # Warm the caches once the server is up (first-ready sync, not a loop).
    (
      for _ in $(seq 1 30); do
        sleep 2
        h=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null)
        [ "$h" = "200" ] && prewarm && break
      done
    ) &
    wait $pid
    rc=$?
    mark "dev server exited (rc=$rc); respawn in 3s"
    sleep 3
  else
    # The TTL keepalive — 45s < the 60s payload/census TTLs.
    if [ "$prewarm_after" -le 0 ]; then
      prewarm || true
      prewarm_after=45
    fi
    prewarm_after=$((prewarm_after - 5))
    sleep 5
  fi
done
