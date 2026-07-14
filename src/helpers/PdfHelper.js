const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getReportFontCss, copyFontsToDir } = require('./ReportFontHelper');

const execFileAsync = promisify(execFile);

const chromeCandidates = process.platform === 'win32'
  ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  : [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      // Try the next browser path.
    }
  }
  const error = new Error('مرورگر Chrome/Chromium برای ساخت PDF نصب نیست — روی سرور: sudo bash /opt/food/deploy/update.sh');
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
      env: {
        ...process.env,
        HOME: runtimeRoot,
        XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
        XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
        TMPDIR: os.tmpdir(),
      },
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

module.exports = { htmlToPdfBuffer, findChrome, pdfCacheRoot };
