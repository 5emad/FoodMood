const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const FONT_SETS = {
  vazirmatn: {
    family: "'Vazirmatn', Tahoma, sans-serif",
    familyName: 'Vazirmatn',
    files: [
      { fileName: 'Vazirmatn-Regular.woff2', weight: 400 },
      { fileName: 'Vazirmatn-Bold.woff2', weight: 700 },
    ],
    dirs: [
      path.join(__dirname, '..', 'assets', 'fonts'),
      path.join(__dirname, '..', '..', 'public', 'vendor', 'vazirmatn'),
    ],
  },
  yekanbakh: {
    family: "'Yekan Bakh FaNum', Tahoma, sans-serif",
    familyName: 'Yekan Bakh FaNum',
    files: [
      { fileName: 'YekanBakhFaNum-Regular.woff2', weight: 400 },
      { fileName: 'YekanBakhFaNum-Bold.woff2', weight: 600 },
      { fileName: 'YekanBakhFaNum-Bold.woff2', weight: 700 },
    ],
    dirs: [
      path.join(__dirname, '..', '..', 'public', 'vendor', 'yekanbakh'),
    ],
  },
};

function resolveUiFont(value) {
  return String(value || '').trim() === 'yekanbakh' ? 'yekanbakh' : 'vazirmatn';
}

function getFontSet(uiFont) {
  return FONT_SETS[resolveUiFont(uiFont)];
}

function resolveFontPath(fileName, uiFont) {
  const set = getFontSet(uiFont);
  for (const dir of set.dirs) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) return filePath;
  }
  // fallback: try other set dirs for same filename (vazir assets)
  for (const other of Object.values(FONT_SETS)) {
    for (const dir of other.dirs) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) return filePath;
    }
  }
  throw new Error(`فونت گزارش یافت نشد: ${fileName}`);
}

function fontFaceCss(familyName, src, weight) {
  return `
@font-face {
  font-family: '${familyName}';
  font-style: normal;
  font-weight: ${weight};
  src: url('${src}') format('woff2');
}`;
}

function uniqueCopyFiles(files) {
  const seen = new Set();
  return files.filter(({ fileName }) => {
    if (seen.has(fileName)) return false;
    seen.add(fileName);
    return true;
  });
}

function getReportFontCss(options = {}) {
  const uiFont = resolveUiFont(options.uiFont);
  const set = getFontSet(uiFont);
  const faces = set.files.map(({ fileName, weight }) => {
    if (options.relativePrefix) {
      return fontFaceCss(set.familyName, `${options.relativePrefix}${fileName}`, weight);
    }
    const filePath = resolveFontPath(fileName, uiFont);
    const data = fs.readFileSync(filePath).toString('base64');
    return fontFaceCss(set.familyName, `data:font/woff2;base64,${data}`, weight);
  }).join('\n');

  return `${faces}

:root {
  --report-font-family: ${set.family};
}
html, body {
  font-family: var(--report-font-family) !important;
}
body, body * {
  font-family: inherit;
}`;
}

function getReportFontFamily(uiFont) {
  return getFontSet(uiFont).family;
}

async function copyFontsToDir(targetDir, uiFont) {
  const set = getFontSet(uiFont);
  const outputDir = path.join(targetDir, 'fonts');
  await fsPromises.mkdir(outputDir, { recursive: true });
  for (const { fileName } of uniqueCopyFiles(set.files)) {
    await fsPromises.copyFile(
      resolveFontPath(fileName, uiFont),
      path.join(outputDir, fileName),
    );
  }
  return './fonts/';
}

module.exports = {
  resolveUiFont,
  getReportFontCss,
  getReportFontFamily,
  copyFontsToDir,
};
