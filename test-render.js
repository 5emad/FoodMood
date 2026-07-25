const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, 'backend', 'views', 'user', 'dashboard.ejs');
const templateStr = fs.readFileSync(templatePath, 'utf8');

const capabilities = {
  showStatement: true
};

try {
  const rendered = ejs.render(templateStr, {
    capabilities,
    portalSettings: { showFinancialStatementToUsers: true },
    user: { fullName: 'Test', department: { name: 'Test' } },
    safeJsonForHtml: (obj) => JSON.stringify(obj),
    jsAsset: (name) => `/js/${name}.js`,
    appVersionMajorFa: '1',
    appVersion: '1.0',
    appVersionMajor: '1',
    appVersionFa: '1'
  }, { filename: templatePath });
  
  const lines = rendered.split('\n');
  const btnLines = lines.filter(l => l.includes('id="statementTabBtn"'));
  console.log('When showStatement is TRUE:');
  console.log(btnLines.join('\n'));

  const renderedHidden = ejs.render(templateStr, {
    capabilities: { showStatement: false },
    portalSettings: { showFinancialStatementToUsers: false },
    user: { fullName: 'Test', department: { name: 'Test' } },
    safeJsonForHtml: (obj) => JSON.stringify(obj),
    jsAsset: (name) => `/js/${name}.js`,
    appVersionMajorFa: '1',
    appVersion: '1.0',
    appVersionMajor: '1',
    appVersionFa: '1'
  }, { filename: templatePath });
  
  const linesHidden = renderedHidden.split('\n');
  const btnLinesHidden = linesHidden.filter(l => l.includes('id="statementTabBtn"'));
  console.log('\nWhen showStatement is FALSE:');
  console.log(btnLinesHidden.join('\n'));

} catch (err) {
  console.error(err);
}
