const fs = require('fs');
const path = require('path');
const { writeSecurityLog } = require('../services/SecurityLogService');

const POLL_MS = 2000;
const seen = new Set();
let offset = 0;
let timer = null;
let started = false;

function remember(key) {
  seen.add(key);
  if (seen.size > 2000) {
    const drop = [...seen].slice(0, 500);
    drop.forEach((k) => seen.delete(k));
  }
}

async function ingestLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return;
  }
  if (entry.result !== 'blocked') return;

  const key = entry.requestId
    || `${entry.timestamp}|${entry.ip}|${entry.rule}|${entry.path}`;
  if (seen.has(key)) return;
  remember(key);

  const fakeReq = {
    ip: entry.ip || '',
    connection: { remoteAddress: entry.ip || '' },
    headers: { 'user-agent': entry.userAgent || '' },
  };

  await writeSecurityLog(
    fakeReq,
    'waf_blocked',
    null,
    `مسدودسازی WAF: ${entry.rule || 'unknown'}`,
    {
      rule: entry.rule || '',
      path: entry.path || '',
      method: entry.method || '',
      matched: String(entry.matched || '').slice(0, 240),
      source: entry.source || '',
      severity: entry.severity || 'medium',
      engine: 'firewtwall',
      requestId: entry.requestId || '',
    },
  );
}

async function poll(logPath) {
  try {
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size < offset) offset = 0;
    if (stat.size === offset) return;

    const fd = fs.openSync(logPath, 'r');
    try {
      const length = stat.size - offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, offset);
      offset = stat.size;
      const chunk = buf.toString('utf8');
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        // eslint-disable-next-line no-await-in-loop
        await ingestLine(line);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    console.warn('[WAF] log bridge poll failed:', err.message);
  }
}

/**
 * شروع پل لاگ WAF → SecurityLog (فقط خطوط جدید پس از استارت)
 */
function startWafLogBridge(logPath) {
  if (started) return;
  started = true;

  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');

  try {
    offset = fs.statSync(logPath).size;
  } catch {
    offset = 0;
  }

  timer = setInterval(() => {
    poll(logPath).catch(() => {});
  }, POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function resetWafLogFile(logPath) {
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, '', 'utf8');
    offset = 0;
    seen.clear();
  } catch (err) {
    console.warn('[WAF] log reset failed:', err.message);
  }
}

module.exports = { startWafLogBridge, resetWafLogFile };
