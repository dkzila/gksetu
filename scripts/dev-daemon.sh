#!/bin/bash
# GlobIQ dev daemon — detached dev server (setsid survives tool-call exits).
cd /home/z/my-project
export NODE_ENV=development
exec bun run dev
