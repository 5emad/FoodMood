#!/bin/sh
set -eu

# In containers, nproc often returns the *host* CPU count and can fork too many
# workers (OOM → crash → compose "Waiting" on health). Cap auto mode safely.
resolve_auto_workers() {
  cpus=1
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    # cgroup v2: "max 100000" or "200000 100000"
    quota="$(awk '{print $1}' /sys/fs/cgroup/cpu.max 2>/dev/null || echo max)"
    period="$(awk '{print $2}' /sys/fs/cgroup/cpu.max 2>/dev/null || echo 100000)"
    if [ "$quota" != "max" ] && [ "${period:-0}" -gt 0 ] 2>/dev/null; then
      cpus=$((quota / period))
      if [ "$cpus" -lt 1 ]; then cpus=1; fi
    elif command -v nproc >/dev/null 2>&1; then
      cpus="$(nproc)"
    fi
  elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]; then
    quota="$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null || echo -1)"
    period="$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null || echo 100000)"
    if [ "$quota" -gt 0 ] 2>/dev/null && [ "${period:-0}" -gt 0 ] 2>/dev/null; then
      cpus=$((quota / period))
      if [ "$cpus" -lt 1 ]; then cpus=1; fi
    elif command -v nproc >/dev/null 2>&1; then
      cpus="$(nproc)"
    fi
  elif command -v nproc >/dev/null 2>&1; then
    cpus="$(nproc)"
  fi

  # Hard cap: with app×2 replicas, more than 2 workers per container is risky
  if [ "$cpus" -gt 2 ]; then
    cpus=2
  fi
  if [ "$cpus" -lt 1 ]; then
    cpus=1
  fi
  echo "$cpus"
}

case "${CLUSTER_WORKERS:-auto}" in
  auto|AUTO|"")
    export CLUSTER_WORKERS="$(resolve_auto_workers)"
    ;;
esac

echo "[foodmood] CLUSTER_WORKERS=${CLUSTER_WORKERS} NODE_ENV=${NODE_ENV:-production}"

exec "$@"
