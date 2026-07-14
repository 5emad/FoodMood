const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { getReportFontCss, copyFontsToDir } = require('./ReportFontHelper');

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
  await fs.mkdir(path.join(root, 'puppeteer-profile'), { recursive: true, mode: 0o700 });
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
    PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || path.join(path.dirname(runtimeRoot), 'puppeteer'),
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  };
}

async function launchBrowser(runtimeRoot) {
  const puppeteer = require('puppeteer');
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--allow-file-access-from-files',
    ],
    userDataDir: path.join(runtimeRoot, 'puppeteer-profile'),
    env: buildChromeEnv(runtimeRoot),
  };

  if (process.env.CHROME_BIN) {
    launchOptions.executablePath = process.env.CHROME_BIN;
  }

  return puppeteer.launch(launchOptions);
}

async function htmlToPdfBuffer(html) {
  const runtimeRoot = pdfCacheRoot();
  await ensurePdfRuntimeDirs(runtimeRoot);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'food-report-'));
  const htmlPath = path.join(dir, 'report.html');

  try {
    const fontPrefix = await copyFontsToDir(dir);
    const fontCss = getReportFontCss({ relativePrefix: fontPrefix });
    const htmlWithFonts = injectLocalFonts(html, fontCss);
    await fs.writeFile(htmlPath, htmlWithFonts, 'utf8');

    const browser = await launchBrowser(runtimeRoot);
    try {
      const page = await browser.newPage();
      const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      const pdfBuffer = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        format: 'A4',
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (error) {
    const detail = error?.message || 'نامشخص';
    const wrapped = new Error(
      detail.includes('Could not find Chrome')
        ? 'مرورگر PDF هنوز دانلود نشده — روی سرور: curl -fsSL .../deploy/update.sh | sudo bash'
        : `خطا در ساخت PDF: ${detail}`,
    );
    wrapped.status = 503;
    wrapped.expose = true;
    throw wrapped;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  htmlToPdfBuffer,
  pdfCacheRoot,
  buildChromeEnv,
};
