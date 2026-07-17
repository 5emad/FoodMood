const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const INSTALL_DIR = process.env.FOOD_INSTALL_DIR || '/opt/food';
const SSL_DIR = path.join(INSTALL_DIR, 'certs', 'ssl');
const CUSTOM_CERT = path.join(SSL_DIR, 'custom.crt');
const CUSTOM_KEY = path.join(SSL_DIR, 'custom.key');
const APPLY_SCRIPT = path.join(INSTALL_DIR, 'deploy', 'apply-custom-ssl.sh');

function ensureSslDir() {
  fs.mkdirSync(SSL_DIR, { recursive: true, mode: 0o750 });
}

function hasCustomCertificate() {
  return fs.existsSync(CUSTOM_CERT) && fs.existsSync(CUSTOM_KEY);
}

function getSslStatus() {
  const trustTls = process.env.TRUST_TLS === 'true';
  const appUrl = String(process.env.APP_URL || '').trim();
  const custom = hasCustomCertificate();
  let certSubject = '';
  if (custom) {
    try {
      const pem = fs.readFileSync(CUSTOM_CERT, 'utf8');
      const match = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
      if (match) certSubject = 'installed';
    } catch {
      certSubject = '';
    }
  }
  return {
    customCertificate: custom,
    trustTls,
    appUrl,
    mode: custom ? 'trusted' : (trustTls ? 'https' : 'http'),
    hint: custom
      ? 'گواهی سفارشی نصب شده — مرورگر باید قفل امن را نشان دهد.'
      : 'HTTPS فعال است (گواهی موقت). مرورگر Not Secure نشان می‌دهد تا گواهی واقعی آپلود شود.',
  };
}

async function saveCustomCertificate(certBuffer, keyBuffer) {
  ensureSslDir();
  const certText = certBuffer.toString('utf8').trim();
  const keyText = keyBuffer.toString('utf8').trim();
  if (!certText.includes('BEGIN CERTIFICATE')) {
    throw Object.assign(new Error('فایل گواهی معتبر نیست (فرمت PEM)'), { status: 400 });
  }
  if (!keyText.includes('BEGIN') || !keyText.includes('PRIVATE KEY')) {
    throw Object.assign(new Error('فایل کلید خصوصی معتبر نیست (فرمت PEM)'), { status: 400 });
  }
  fs.writeFileSync(CUSTOM_CERT, `${certText}\n`, { mode: 0o644 });
  fs.writeFileSync(CUSTOM_KEY, `${keyText}\n`, { mode: 0o640 });
}

function logSslEvent(level, message, detail) {
  try {
    const { writeSystemLog } = require('../services/SystemLogService');
    writeSystemLog(level, 'server', message, {
      event: 'ssl_apply',
      code: 'SSL_APPLY',
      detail: String(detail || '').slice(0, 2000),
    });
  } catch { /* logging must not break the flow */ }
}

async function applyCustomCertificate() {
  if (!fs.existsSync(APPLY_SCRIPT)) {
    throw Object.assign(new Error('اسکریپت اعمال گواهی روی سرور یافت نشد'), { status: 500, expose: true });
  }
  try {
    const { stdout, stderr } = await execFileAsync('sudo', ['-n', APPLY_SCRIPT], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    // Keep full output in server logs only — never return stdout/stderr to clients.
    logSslEvent('info', 'گواهی SSL سفارشی اعمال شد', `${stdout}\n${stderr}`);
    return { applied: true };
  } catch (error) {
    const raw = String(error.stderr || error.message || '');
    logSslEvent('error', 'اعمال گواهی SSL ناموفق بود', raw);
    if (/sudo: a password is required/i.test(raw)) {
      throw Object.assign(new Error('دسترسی sudo برای اعمال گواهی تنظیم نشده است؛ راهنمای استقرار را ببینید'), { status: 503, expose: true });
    }
    throw Object.assign(new Error('اعمال گواهی ناموفق بود؛ جزئیات در لاگ سیستم ثبت شد'), { status: 503, expose: true });
  }
}

module.exports = {
  SSL_DIR,
  CUSTOM_CERT,
  CUSTOM_KEY,
  getSslStatus,
  saveCustomCertificate,
  applyCustomCertificate,
};
