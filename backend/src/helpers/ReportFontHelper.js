const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const FONT_FILES = [
  { fileName: 'Vazirmatn-Regular.woff2', weight: 400 },
  { fileName: 'Vazirmatn-Bold.woff2', weight: 700 },
];

const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');

function fontFaceCss(src, weight) {
  return `
@font-face {
  font-family: 'Vazirmatn';
  font-style: normal;
  font-weight: ${weight};
  src: url('${src}') format('woff2');
}`;
}

function getReportFontCss(options = {}) {
  if (options.relativePrefix) {
    return FONT_FILES.map(({ fileName, weight }) => (
      fontFaceCss(`${options.relativePrefix}${fileName}`, weight)
    )).join('\n');
  }

  return FONT_FILES.map(({ fileName, weight }) => {
    const filePath = path.join(fontsDir, fileName);
    const data = fs.readFileSync(filePath).toString('base64');
    return fontFaceCss(`data:font/woff2;base64,${data}`, weight);
  }).join('\n');
}

async function copyFontsToDir(targetDir) {
  const outputDir = path.join(targetDir, 'fonts');
  await fsPromises.mkdir(outputDir, { recursive: true });
  for (const { fileName } of FONT_FILES) {
    await fsPromises.copyFile(
      path.join(fontsDir, fileName),
      path.join(outputDir, fileName),
    );
  }
  return './fonts/';
}

module.exports = { getReportFontCss, copyFontsToDir };
