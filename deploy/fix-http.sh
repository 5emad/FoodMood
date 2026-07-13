#!/usr/bin/env bash
# Legacy alias — runs the full update + HTTP/CSS repair.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update.sh" "$@"
