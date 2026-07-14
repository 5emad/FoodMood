#!/usr/bin/env bash
# Deprecated — use update.sh --status
exec "$(dirname "$0")/update.sh" --status "$@"
