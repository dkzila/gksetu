#!/bin/bash
# GKSetu dev daemon — detached, self-healing dev server (the documented
# P5-S3/P9-S3-followup pattern: a supervisor loop that survives tool-call
# exits and respawns `next dev` whenever the port goes idle).
#
# Start (idempotent — a live listener on :3000 is left alone):
#   setsid nohup bash scripts/dev-daemon.sh >/dev/null 2>&1 </dev/null &
cd /home/z/my-project
export NODE_ENV=development

mark() { echo "[daemon] $(date -u +%FT%TZ) $*" >> /home/z/my-project/dev.log; }

mark "supervisor started (pid $$)"

while true; do
  # Is anything already serving on :3000? (000 = nothing reachable)
  code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$code" = "000" ]; then
    mark "port 3000 idle — spawning dev server"
    bun run dev &
    pid=$!
    wait $pid
    rc=$?
    mark "dev server exited (rc=$rc); respawn in 3s"
    sleep 3
  else
    sleep 5
  fi
done
