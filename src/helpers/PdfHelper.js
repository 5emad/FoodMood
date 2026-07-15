const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getReportFontCss, copyFontsToDir } = require('./ReportFontHelper');

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';

const SYSTEM_CHROME_PATHS = [
  process.env.CHROME_BIN,
  process.env.EDGE_BIN,
  // Windows
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  // Linux
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

function bundledChromePath() {
  const installDir = process.env.FOOD_INSTALL_DIR || path.join(process.cwd());
  if (IS_WIN) {
    return path.join(installDir, '.cache', 'chrome-win64', 'chrome.exe');
  }
  return path.join(installDir, '.cache', 'chrome-linux64', 'chrome');
}

function isSnapBinary(binaryPath) {
  return String(binaryPath || '').includes('/snap/');
}

async function isUsableChromeBinary(candidate) {
  if (!candidate || (!IS_WIN && isSnapBinary(candidate))) return false;
  try {
    await fs.access(candidate);
    if (!IS_WIN) {
      const realPath = await fs.realpath(candidate);
      if (isSnapBinary(realPath)) return false;
      const head = await fs.readFile(realPath, { encoding: 'utf8' }).catch(() => '');
      if (head.startsWith('#!') && /snap/i.test(head)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function chromeMissingMessage() {
  if (IS_WIN) {
    return 'مرورگر PDF یافت نشد. Chrome یا Edge را نصب کنید، یا CHROME_BIN را به مسیر chrome.exe تنظیم کنید.';
  }
  return 'مرورگر PDF نصب نیست — روی سرور: curl -fsSL .../deploy/update.sh | sudo bash';
}

async function findChrome() {
  const candidates = [
    ...SYSTEM_CHROME_PATHS,
    bundledChromePath(),
  ];
  for (const candidate of candidates) {
    if (await isUsableChromeBinary(candidate)) return candidate;
  }
  const error = new Error(chromeMissingMessage());
  error.status = 503;
  error.expose = true;
  throw error;
}

function injectLocalFonts(html, fontCss) {
  const styleTag = `<style id="report-fonts">\n${fontCss}\n</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleTag}\n</head>`);
  }
  return `${styleTag}\n${html}`;
}

function pdfCacheRoot() {
  const installDir = process.env.FOOD_INSTALL_DIR || path.join(process.cwd());
  return path.join(installDir, '.cache', 'pdf-runtime');
}

async function ensurePdfRuntimeDirs(root) {
  await fs.mkdir(path.join(root, 'config'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(root, 'cache'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(root, 'run'), { recursive: true, mode: 0o700 });
}

function buildChromeEnv(runtimeRoot) {
  const runtimeDir = path.join(runtimeRoot, 'run');
  const env = { ...process.env };
  delete env.SNAP;
  delete env.SNAP_VERSION;
  delete env.SNAP_NAME;
  delete env.SNAP_INSTANCE_NAME;
  delete env.SNAP_USER_DATA;
  delete env.SNAP_REAL_HOME;

  const next = {
    ...env,
    HOME: runtimeRoot,
    XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
    XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
    XDG_RUNTIME_DIR: runtimeDir,
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
  };

  if (!IS_WIN) {
    next.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  }
  return next;
}

function toFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  if (IS_WIN) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

async function htmlToPdfBuffer(html) {
  const chromePath = await findChrome();
  const runtimeRoot = pdfCacheRoot();
  await ensurePdfRuntimeDirs(runtimeRoot);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'food-report-'));
  const htmlPath = path.join(dir, 'report.html');
  const pdfPath = path.join(dir, 'report.pdf');

  try {
    const fontPrefix = await copyFontsToDir(dir);
    const fontCss = getReportFontCss({ relativePrefix: fontPrefix });
    const htmlWithFonts = injectLocalFonts(html, fontCss);
    await fs.writeFile(htmlPath, htmlWithFonts, 'utf8');
    const fileUrl = toFileUrl(htmlPath);

    await execFileAsync(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfPath}`,
      '--print-to-pdf-no-header',
      fileUrl,
    ], {
      timeout: 90000,
      env: buildChromeEnv(runtimeRoot),
      windowsHide: true,
    });

    return await fs.readFile(pdfPath);
  } catch (error) {
    if (error?.expose) throw error;
    // Log full detail server-side; client only sees a fixed message.
    try {
      const { writeSystemLog } = require('../services/SystemLogService');
      writeSystemLog('error', 'api', 'خطا در ساخت PDF', {
        event: 'pdf_generation_failed',
        code: 'PDF_FAIL',
        detail: String(error?.stderr || error?.message || '').slice(0, 2000),
        stack: error?.stack || '',
      });
    } catch { /* logging must not break the response */ }
    const wrapped = new Error('خطا در ساخت PDF؛ لطفاً دوباره تلاش کنید');
    wrapped.status = 503;
    wrapped.expose = true;
    throw wrapped;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  htmlToPdfBuffer,
  findChrome,
  pdfCacheRoot,
  buildChromeEnv,
  bundledChromePath,
};
