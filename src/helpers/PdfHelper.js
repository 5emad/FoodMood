const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getReportFontCss, copyFontsToDir } = require('./ReportFontHelper');

const execFileAsync = promisify(execFile);

const SYSTEM_CHROME_PATHS = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].filter(Boolean);

function bundledChromePath() {
  const installDir = process.env.FOOD_INSTALL_DIR || path.join(process.cwd());
  return path.join(installDir, '.cache', 'chrome-linux64', 'chrome');
}

function isSnapBinary(binaryPath) {
  return String(binaryPath || '').includes('/snap/');
}

async function isUsableChromeBinary(candidate) {
  if (!candidate || isSnapBinary(candidate)) return false;
  try {
    await fs.access(candidate);
    const realPath = await fs.realpath(candidate);
    if (isSnapBinary(realPath)) return false;
    const head = await fs.readFile(realPath, { encoding: 'utf8' }).catch(() => '');
    if (head.startsWith('#!') && /snap/i.test(head)) return false;
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const candidates = [
    ...SYSTEM_CHROME_PATHS,
    bundledChromePath(),
  ];
  for (const candidate of candidates) {
    if (await isUsableChromeBinary(candidate)) return candidate;
  }
  const error = new Error('مرورگر PDF نصب نیست — روی سرور: curl -fsSL .../deploy/update.sh | sudo bash');
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
      '--allow-file-access-from-files',
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
  bundledChromePath,
};
