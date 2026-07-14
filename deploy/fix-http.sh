#!/usr/bin/env bash
# Legacy alias — runs the full update + HTTPS/TLS setup.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update.sh" "$@"
