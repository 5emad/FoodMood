/**
 * IP کلاینت امن برای rate-limit / لاگ.
 * پیش‌فرض: فقط سوکت (ضد جعل X-Forwarded-For).
 * اگر سوکت از TRUSTED_PROXIES / WAF_TRUSTED_PROXIES باشد → Express req.ip (پشت nginx داخل داکر).
 */

function envCidrList() {
  const raw = String(process.env.TRUSTED_PROXIES || process.env.WAF_TRUSTED_PROXIES || '').trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/i, '').split('%')[0].trim();
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = ((n << 8) + v) >>> 0;
  }
  return n;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (ipInt & mask) === (rangeInt & mask);
}

function ipMatches(ip, entry) {
  const clean = normalizeIp(ip);
  const rule = String(entry || '').trim();
  if (!clean || !rule) return false;
  if (!rule.includes('/')) return clean === normalizeIp(rule);
  if (clean.includes(':') || rule.includes(':')) {
    // IPv6 exact / simple prefix not fully implemented — exact match only
    return clean === normalizeIp(rule.split('/')[0]);
  }
  try {
    return ipv4InCidr(clean, rule);
  } catch {
    return false;
  }
}

function isTrustedProxySocket(socketIp) {
  const list = envCidrList();
  if (!list.length) return false;
  return list.some((entry) => ipMatches(socketIp, entry));
}

/** IP خام سوکت — هرگز از XFF نمی‌خواند */
function directClientIp(req) {
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(raw) || 'unknown';
}

/**
 * IP مؤثر برای محدودیت نرخ و امنیت.
 * پشت پروکسی قابل‌اعتماد (داکر/nginx داخلی) از req.ip استفاده می‌کند.
 */
function resolveClientIp(req) {
  const socketIp = directClientIp(req);
  if (socketIp !== 'unknown' && isTrustedProxySocket(socketIp)) {
    const fromExpress = normalizeIp(req.ip);
    if (fromExpress) return fromExpress;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const fromXff = normalizeIp(xff);
    if (fromXff) return fromXff;
  }
  return socketIp;
}

module.exports = {
  directClientIp,
  resolveClientIp,
  isTrustedProxySocket,
  normalizeIp,
};
