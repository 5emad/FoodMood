const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const INSTALL_DIR = process.env.FOOD_INSTALL_DIR || '/opt/food';
const SSL_DIR = path.join(INSTALL_DIR, 'certs', 'ssl');
const CUSTOM_CERT = path.join(SSL_DIR, 'custom.crt');
const CUSTOM_KEY = path.join(SSL_DIR, 'custom.key');
const APPLY_SCRIPT = path.join(INSTALL_DIR, 'deploy', 'apply-custom-ssl.sh');
const NGINX_CERT = '/etc/nginx/ssl/foodmood.crt';

function ensureSslDir() {
  fs.mkdirSync(SSL_DIR, { recursive: true, mode: 0o755 });
}

function hasCustomCertificate() {
  return fs.existsSync(CUSTOM_CERT) && fs.existsSync(CUSTOM_KEY);
}

async function opensslArgs(args) {
  const { stdout } = await execFileAsync('openssl', args, { timeout: 15000, maxBuffer: 1024 * 512 });
  return String(stdout || '').trim();
}

async function verifyCertKeyPair(certText, keyText) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ssl-'));
  const certPath = path.join(tmpDir, 'cert.pem');
  const keyPath = path.join(tmpDir, 'key.pem');
  try {
    fs.writeFileSync(certPath, certText);
    fs.writeFileSync(keyPath, keyText);
    const certPub = (await opensslArgs(['x509', '-in', certPath, '-noout', '-pubkey'])).trim();
    const keyPub = (await opensslArgs(['pkey', '-in', keyPath, '-pubout'])).trim();
    return Boolean(certPub && keyPub && certPub === keyPub);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractSslErrorDetail(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^sudo:/i.test(line));
  return lines.slice(-4).join(' | ').slice(0, 400);
}

function translateSslApplyError(raw) {
  const text = String(raw || '');
  if (/sudo: a password is required|not allowed to execute/i.test(text)) {
    return 'دسترسی sudo برای اعمال گواهی تنظیم نشده است؛ یک‌بار update.sh را اجرا کنید';
  }
  if (/do not match|Certificate and private key/i.test(text)) {
    return 'گواهی و کلید خصوصی با هم مطابقت ندارند';
  }
  if (/encrypted/i.test(text)) {
    return 'کلید خصوصی رمزدار است؛ نسخهٔ بدون رمز (PEM) آپلود کنید';
  }
  if (/Invalid certificate/i.test(text)) {
    return 'فایل گواهی معتبر نیست (فرمت PEM)';
  }
  if (/Invalid private key/i.test(text)) {
    return 'فایل کلید خصوصی معتبر نیست (فرمت PEM)';
  }
  if (/nginx config test failed/i.test(text)) {
    if (/ssl_certificate|SSL_CTX|certificate/i.test(text)) {
      return 'Nginx گواهی را قبول نکرد؛ فایل full chain (.crt) و کلید جفت‌شده را بررسی کنید';
    }
    return 'پیکربندی Nginx نامعتبر شد';
  }
  if (/foodmood service restart failed/i.test(text)) {
    return 'گواهی نصب شد ولی سرویس FoodMood ری‌استارت نشد؛ journalctl -u foodmood را ببینید';
  }
  if (/nginx failed to start|not listening on port 443/i.test(text)) {
    return 'Nginx بعد از نصب گواهی بالا نیامد';
  }
  if (/Missing certificate/i.test(text)) {
    return 'فایل گواهی روی سرور یافت نشد؛ دوباره آپلود کنید';
  }
  const detail = extractSslErrorDetail(text);
  if (detail) return `اعمال گواهی ناموفق بود: ${detail}`;
  return 'اعمال گواهی ناموفق بود؛ جزئیات در لاگ سیستم ثبت شد';
}

async function parseCertificateInfo(certPath) {
  if (!fs.existsSync(certPath)) return null;
  try {
    const subject = await opensslArgs(['x509', '-in', certPath, '-noout', '-subject']);
    const issuer = await opensslArgs(['x509', '-in', certPath, '-noout', '-issuer']);
    const dates = await opensslArgs(['x509', '-in', certPath, '-noout', '-dates']);
    let san = '';
    try {
      san = await opensslArgs(['x509', '-in', certPath, '-noout', '-ext', 'subjectAltName']);
    } catch { /* no SAN */ }

    const notAfterMatch = dates.match(/notAfter=(.+)/);
    const notAfter = notAfterMatch ? new Date(notAfterMatch[1]) : null;
    const daysUntilExpiry = notAfter
      ? Math.floor((notAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    const dnsMatch = san.match(/DNS:([^,\s]+)/);
    const cnMatch = subject.match(/CN\s*=\s*([^,/]+)/);
    const primaryHost = (dnsMatch && dnsMatch[1]) || (cnMatch && cnMatch[1]) || '';

    const selfSigned = subject.replace(/^subject=/i, '').trim() === issuer.replace(/^issuer=/i, '').trim();

    return {
      subject: subject.replace(/^subject=/i, '').trim(),
      issuer: issuer.replace(/^issuer=/i, '').trim(),
      primaryHost,
      notAfter: notAfter ? notAfter.toISOString() : null,
      daysUntilExpiry,
      selfSigned,
      nginxInstalled: fs.existsSync(NGINX_CERT),
    };
  } catch {
    return null;
  }
}

function buildSslHint({ custom, info, trustTls }) {
  if (!custom) {
    return trustTls
      ? 'HTTPS فعال است (گواهی موقت خودامضا). مرورگر «Not Secure» نشان می‌دهد تا گواهی معتبر آپلود شود.'
      : 'اتصال امن فعال نیست.';
  }
  if (!info) {
    return 'گواهی سفارشی ذخیره شده؛ جزئیات قابل خواندن نیست.';
  }
  if (info.daysUntilExpiry != null && info.daysUntilExpiry < 0) {
    return 'گواهی منقضی شده است. گواهی جدید آپلود کنید.';
  }
  if (info.selfSigned) {
    return 'گواهی خودامضا است — مرورگر «Not Secure» نشان می‌دهد. از گواهی CA معتبر استفاده کنید.';
  }
  const hostHint = info.primaryHost
    ? `سایت را با https://${info.primaryHost} باز کنید (نه IP).`
    : 'آدرس سایت را با نام دامنهٔ گواهی یکسان کنید.';
  if (!info.nginxInstalled) {
    return `گواهی ذخیره شد ولی هنوز روی Nginx نصب نشده. ${hostHint}`;
  }
  return `گواهی روی Nginx نصب شد. ${hostHint} اگر هنوز Not Secure است، فایل گواهی را همراه زنجیرهٔ میانی (full chain) آپلود کنید.`;
}

async function getSslStatus() {
  const trustTls = process.env.TRUST_TLS === 'true'
    || /^https:\/\//i.test(process.env.APP_URL || '');
  const appUrl = String(process.env.APP_URL || '').trim();
  const custom = hasCustomCertificate();
  const info = custom ? await parseCertificateInfo(CUSTOM_CERT) : null;

  let mode = trustTls ? 'https' : 'http';
  if (custom && info && !info.selfSigned && info.daysUntilExpiry != null && info.daysUntilExpiry >= 0) {
    mode = 'trusted';
  } else if (custom) {
    mode = 'custom';
  }

  return {
    customCertificate: custom,
    trustTls,
    appUrl,
    mode,
    primaryHost: info?.primaryHost || '',
    notAfter: info?.notAfter || null,
    daysUntilExpiry: info?.daysUntilExpiry ?? null,
    selfSigned: info?.selfSigned ?? null,
    nginxInstalled: info?.nginxInstalled ?? false,
    hint: buildSslHint({ custom, info, trustTls }),
  };
}

function validatePemPayload(certText, keyText) {
  if (!certText.includes('BEGIN CERTIFICATE')) {
    throw Object.assign(new Error('فایل گواهی معتبر نیست (فرمت PEM)'), { status: 400, expose: true });
  }
  if (!keyText.includes('BEGIN') || !keyText.includes('PRIVATE KEY')) {
    throw Object.assign(new Error('فایل کلید خصوصی معتبر نیست (فرمت PEM)'), { status: 400, expose: true });
  }
}

async function runSslApplyScript(stageCert, stageKey) {
  if (!fs.existsSync(APPLY_SCRIPT)) {
    throw Object.assign(new Error('اسکریپت اعمال گواهی روی سرور یافت نشد'), { status: 500, expose: true });
  }
  try {
    const { stdout, stderr } = await execFileAsync('sudo', ['-n', APPLY_SCRIPT, stageCert, stageKey], {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });
    logSslEvent('info', 'گواهی SSL سفارشی اعمال شد', `${stdout}\n${stderr}`);
    return { stdout, stderr };
  } catch (error) {
    const raw = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n');
    logSslEvent('error', 'اعمال گواهی SSL ناموفق بود', raw);
    const detail = extractSslErrorDetail(raw);
    throw Object.assign(new Error(translateSslApplyError(raw)), {
      status: 503,
      expose: true,
      detail,
    });
  }
}

async function installCustomCertificate(certBuffer, keyBuffer) {
  const certText = certBuffer.toString('utf8').trim();
  const keyText = keyBuffer.toString('utf8').trim();
  validatePemPayload(certText, keyText);

  let matched = false;
  try {
    matched = await verifyCertKeyPair(certText, keyText);
  } catch {
    throw Object.assign(new Error('openssl روی سرور در دسترس نیست؛ نصب openssl الزامی است'), { status: 503, expose: true });
  }
  if (!matched) {
    throw Object.assign(new Error('گواهی و کلید خصوصی با هم مطابقت ندارند'), { status: 400, expose: true });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ssl-'));
  const stageCert = path.join(tmpDir, 'upload.crt');
  const stageKey = path.join(tmpDir, 'upload.key');
  try {
    fs.writeFileSync(stageCert, `${certText}\n`, { mode: 0o600 });
    fs.writeFileSync(stageKey, `${keyText}\n`, { mode: 0o600 });
    await runSslApplyScript(stageCert, stageKey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    const { syncPublicUrlToEnv } = require('./EnvFileHelper');
    const info = await parseCertificateInfo(CUSTOM_CERT);
    if (info?.primaryHost) {
      syncPublicUrlToEnv(`https://${info.primaryHost}`);
    }
  } catch { /* env sync is best-effort */ }

  return { applied: true };
}

async function saveCustomCertificate(certBuffer, keyBuffer) {
  ensureSslDir();
  const certText = certBuffer.toString('utf8').trim();
  const keyText = keyBuffer.toString('utf8').trim();
  validatePemPayload(certText, keyText);

  let matched = false;
  try {
    matched = await verifyCertKeyPair(certText, keyText);
  } catch {
    throw Object.assign(new Error('openssl روی سرور در دسترس نیست'), { status: 503, expose: true });
  }
  if (!matched) {
    throw Object.assign(new Error('گواهی و کلید خصوصی با هم مطابقت ندارند'), { status: 400, expose: true });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ssl-'));
  const stageCert = path.join(tmpDir, 'upload.crt');
  const stageKey = path.join(tmpDir, 'upload.key');
  try {
    fs.writeFileSync(stageCert, `${certText}\n`, { mode: 0o600 });
    fs.writeFileSync(stageKey, `${keyText}\n`, { mode: 0o600 });
    await runSslApplyScript(stageCert, stageKey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function applyCustomCertificate() {
  if (!hasCustomCertificate()) {
    throw Object.assign(new Error('گواهی سفارشی روی سرور یافت نشد'), { status: 400, expose: true });
  }
  return runSslApplyScript(CUSTOM_CERT, CUSTOM_KEY);
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

module.exports = {
  SSL_DIR,
  CUSTOM_CERT,
  CUSTOM_KEY,
  getSslStatus,
  installCustomCertificate,
  saveCustomCertificate,
  applyCustomCertificate,
};
