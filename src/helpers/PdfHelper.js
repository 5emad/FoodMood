const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getReportFontCss, copyFontsToDir } = require('./ReportFontHelper');

const execFileAsync = promisify(execFile);

const DEB_CHROME_PATHS = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

const windowsCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function isSnapBinary(binaryPath) {
  return String(binaryPath || '').includes('/snap/');
}

async function isUsableChromeBinary(candidate) {
  if (!candidate || isSnapBinary(candidate)) return false;

  let realPath = candidate;
  try {
    await fs.access(candidate);
    realPath = await fs.realpath(candidate);
  } catch {
    return false;
  }

  if (isSnapBinary(realPath)) return false;

  const head = await fs.readFile(realPath, { encoding: 'utf8' }).catch(() => '');
  if (head.startsWith('#!')) {
    if (/snap/i.test(head)) return false;
    if (/chromium/i.test(head) && !/google-chrome/i.test(head)) return false;
  }

  return true;
}

async function findChrome() {
  if (process.platform === 'win32') {
    for (const candidate of windowsCandidates) {
      if (await isUsableChromeBinary(candidate)) return candidate;
    }
  } else {
    const candidates = [
      process.env.CHROME_BIN,
      ...DEB_CHROME_PATHS,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await isUsableChromeBinary(candidate)) return candidate;
    }
  }

  const error = new Error(
    'Google Chrome برای ساخت PDF نصب نیست — روی سرور: curl -fsSL .../deploy/update.sh | sudo bash',
  );
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
  return {
    ...env,
    HOME: runtimeRoot,
    XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
    XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
    XDG_RUNTIME_DIR: runtimeDir,
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  };
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
    const fileUrl = `file://${htmlPath.replace(/\\/g, '/')}`;
    await execFileAsync(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfPath}`,
      '--print-to-pdf-no-header',
      fileUrl,
    ], {
      timeout: 90000,
      env: buildChromeEnv(runtimeRoot),
    });

    return await fs.readFile(pdfPath);
  } catch (error) {
    const detail = error?.stderr || error?.message || 'نامشخص';
    const wrapped = new Error(`خطا در ساخت PDF: ${detail}`);
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
  isSnapBinary,
  isUsableChromeBinary,
};
