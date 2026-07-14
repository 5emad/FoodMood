#!/usr/bin/env bash
# Deprecated — use update.sh --diagnose
exec "$(dirname "$0")/update.sh" --diagnose "$@"
