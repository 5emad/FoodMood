const { recordLifecycleEvent } = require('../services/SystemLogService');
const {
  msgServiceUnavailable,
  msgServiceRestored,
  isDatabaseError,
} = require('./SystemLogCatalog');

let healthy = true;
let reason = '';
let since = null;

function markHealthy(source = 'system') {
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
