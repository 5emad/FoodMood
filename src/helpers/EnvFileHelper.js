const fs = require('fs');
const path = require('path');
const { normalizePublicUrl } = require('./AppUrlHelper');

const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '../../.env');

function readEnvFile(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function upsertEnvKey(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  const suffix = content.endsWith('\n') || !content ? '' : '\n';
  return `${content}${suffix}${line}\n`;
}

function readEnvKey(key, filePath = ENV_PATH) {
  const content = readEnvFile(filePath);
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? String(match[1] || '').trim() : '';
}

function isIpHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function hostFromPublicUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function mergeAllowedOrigins(existing, urls) {
  const items = String(existing || '')
    .split(',')
    .map((item) => normalizePublicUrl(item.trim()))
    .filter(Boolean);
  urls.forEach((url) => {
    const normalized = normalizePublicUrl(url);
    if (normalized && !items.includes(normalized)) items.push(normalized);
  });
  return items.join(',');
}

function applyRuntimeEnv({ publicUrl, allowedOrigins } = {}) {
  const { applyRuntimeEnv: apply } = require('./OriginPolicyHelper');
  apply({ publicUrl, allowedOrigins });
}

function syncPublicUrlToEnv(publicUrl, { extraOrigins = [] } = {}) {
  const normalized = normalizePublicUrl(publicUrl);
  if (!normalized) return { updated: false, reason: 'empty' };
  if (!fs.existsSync(ENV_PATH)) return { updated: false, reason: 'missing_env' };

  try {
    const previousUrl = readEnvKey('APP_URL', ENV_PATH);
    const previousOrigins = readEnvKey('ALLOWED_ORIGINS', ENV_PATH);
    let content = readEnvFile(ENV_PATH);
    content = upsertEnvKey(content, 'APP_URL', normalized);
    content = upsertEnvKey(content, 'TRUST_TLS', 'true');
    content = upsertEnvKey(content, 'FORCE_APP_URL', 'false');

    const preservedIpOrigins = readConfiguredOriginList(previousOrigins)
      .filter((origin) => isIpHostname(hostFromPublicUrl(origin)));

    const origins = mergeAllowedOrigins(previousOrigins, [
      normalized,
      previousUrl,
      ...preservedIpOrigins,
      ...extraOrigins,
    ].filter(Boolean));

    if (origins) content = upsertEnvKey(content, 'ALLOWED_ORIGINS', origins);
    fs.writeFileSync(ENV_PATH, content, { encoding: 'utf8', mode: 0o600 });
    applyRuntimeEnv({ publicUrl: normalized, allowedOrigins: origins });
    process.env.FORCE_APP_URL = 'false';
    return { updated: true, publicUrl: normalized, allowedOrigins: origins };
  } catch (error) {
    return { updated: false, reason: error.message };
  }
}

function readConfiguredOriginList(existing) {
  return String(existing || '')
    .split(',')
    .map((item) => normalizePublicUrl(item.trim()))
    .filter(Boolean);
}

module.exports = {
  ENV_PATH,
  readEnvKey,
  syncPublicUrlToEnv,
  mergeAllowedOrigins,
  applyRuntimeEnv,
};
