const { recordLifecycleEvent } = require('../services/SystemLogService');
const {
  msgServiceUnavailable,
  msgServiceRestored,
  isDatabaseError,
} = require('./SystemLogCatalog');

let healthy = true;
let reason = '';
let since = null;
let pendingUnhealthyTimer = null;

function clearPendingUnhealthy() {
  if (pendingUnhealthyTimer) {
    clearTimeout(pendingUnhealthyTimer);
    pendingUnhealthyTimer = null;
  }
}

function markHealthy(source = 'system') {
  clearPendingUnhealthy();
  const wasUnhealthy = !healthy;
  healthy = true;
  reason = '';
  since = null;
  if (wasUnhealthy) {
    recordLifecycleEvent('service_restored', msgServiceRestored(), {
      level: 'info',
      category: source,
      code: 'SERVICE_RESTORED',
    });
  }
}

function markUnhealthy(source, detail = '') {
  // Ignore brief Mongo blips; only flip the portal after the outage sticks.
  const delayMs = source === 'database' ? 2500 : 0;
  const apply = () => {
    pendingUnhealthyTimer = null;
    const wasHealthy = healthy;
    healthy = false;
    reason = detail || source;
    if (!since) since = new Date().toISOString();
    if (wasHealthy) {
      recordLifecycleEvent('service_unavailable', msgServiceUnavailable(detail), {
        level: 'error',
        category: source,
        code: 'SERVICE_UNAVAILABLE',
        detail,
      });
    }
  };

  if (delayMs <= 0) {
    clearPendingUnhealthy();
    apply();
    return;
  }

  reason = detail || source;
  if (!pendingUnhealthyTimer) {
    pendingUnhealthyTimer = setTimeout(apply, delayMs);
  }
}

function isHealthy() {
  return healthy;
}

function getHealthStatus() {
  return {
    healthy,
    reason,
    since,
  };
}

module.exports = {
  markHealthy,
  markUnhealthy,
  isHealthy,
  getHealthStatus,
  isDatabaseError,
};
