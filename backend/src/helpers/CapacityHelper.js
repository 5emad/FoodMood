/**
 * maxCapacity <= 0 means "inherit system default".
 * Positive values are treated as an explicit per-item override.
 * When capacity limiting is disabled, returns 0 (unlimited).
 */
function resolveEffectiveCapacity(maxCapacity, defaultCapacity, capacityEnabled = true) {
  if (capacityEnabled === false) return 0;
  const stored = Number(maxCapacity);
  const fallback = Math.max(Number(defaultCapacity) || 0, 0);
  if (!(stored > 0)) return fallback;
  return stored;
}

function isCapacityFull(reservedCount, effectiveCapacity) {
  const capacity = Number(effectiveCapacity) || 0;
  if (capacity <= 0) return false;
  return Number(reservedCount || 0) >= capacity;
}

module.exports = {
  resolveEffectiveCapacity,
  isCapacityFull,
};
