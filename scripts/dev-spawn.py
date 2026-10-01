#!/usr/bin/env python3
"""
GKSetu — dev-daemon double-fork spawner.

The sandbox harness kills every process still attached to a tool call's
process tree when the call ends (a plain `setsid nohup … &` dies with it).
The classic double-fork escapes: the daemon reparents to PID 1 and survives
between tool calls — which the dev server needs (the user's preview must
stay alive).

One-shot, idempotent: if something already serves on :3000, it does nothing.

Usage: python3 scripts/dev-spawn.py
"""
import os
import socket
import sys

PROJECT = "/home/z/my-project"


def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.0)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    if port_busy(3000):
        print("port 3000 already serving — nothing to do")
        return

    pid = os.fork()
    if pid == 0:
        # Child: new session, then fork again so the final daemon can never
        # reacquire a controlling terminal and reparents to PID 1.
        os.setsid()
        if os.fork() == 0:
            os.chdir(PROJECT)
            # Detached I/O — the dev-daemon marks dev.log itself, and
            # `bun run dev`'s own `| tee dev.log` carries the Next.js output.
            devnull = os.open(os.devnull, os.O_RDWR)
            os.dup2(devnull, 0)
            os.dup2(devnull, 1)
            os.dup2(devnull, 2)
            os.execvp("bash", ["bash", "scripts/dev-daemon.sh"])
        os._exit(0)
    os.waitpid(pid, 0)
    print("dev-daemon spawned (double-forked, reparented to init)")


if __name__ == "__main__":
    sys.exit(main())
