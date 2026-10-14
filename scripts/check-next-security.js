const fs = require('fs');
const path = require('path');

const roots = [
  process.cwd(),
  path.join(process.cwd(), 'frontend'),
];

function parseVersion(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-canary\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    canary: match[4] === undefined ? null : Number(match[4]),
    raw: version,
  };
}

function compare(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  const ac = a.canary ?? Number.POSITIVE_INFINITY;
  const bc = b.canary ?? Number.POSITIVE_INFINITY;
  return ac - bc;
}

function gte(version, minimum) {
  const parsed = parseVersion(version);
  const min = parseVersion(minimum);
  return parsed && min && compare(parsed, min) >= 0;
}

function isBlockedNextVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  // CVE-2025-66478: RSC/App Router RCE affected Next.js 15.x, 16.x,
  // and 14.3.0-canary.77+; later 2026 RCE advisories require newer LTS patches.
  if (parsed.major === 15) return !gte(version, '15.5.26');
  if (parsed.major === 16) return !gte(version, '16.3.6');
  if (parsed.major === 14 && parsed.minor === 3 && parsed.canary !== null) {
    return compare(parsed, parseVersion('14.3.0-canary.77')) >= 0;
  }
  return false;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectNextVersions(root) {
  const lock = readJson(path.join(root, 'package-lock.json'));
  const versions = new Set();
  if (lock?.packages?.['node_modules/next']?.version) {
    versions.add(lock.packages['node_modules/next'].version);
  }
  if (lock?.dependencies?.next?.version) {
    versions.add(lock.dependencies.next.version);
  }

  const pkg = readJson(path.join(root, 'package.json'));
  const declared = pkg?.dependencies?.next || pkg?.devDependencies?.next;
  if (declared && versions.size === 0) {
    versions.add(`declared:${declared}`);
  }
  return [...versions];
}

const findings = [];
for (const root of roots) {
  if (!fs.existsSync(path.join(root, 'package.json'))) continue;
  for (const version of collectNextVersions(root)) {
    if (version.startsWith('declared:') || isBlockedNextVersion(version)) {
      findings.push({ root, version });
    }
  }
}

if (findings.length) {
  console.error('Blocked vulnerable or unpinned Next.js version(s):');
  for (const item of findings) {
    console.error(`- ${path.relative(process.cwd(), item.root) || '.'}: next@${item.version}`);
  }
  console.error('Use Next.js 15.5.26+ or 16.3.6+ before deployment.');
  process.exit(1);
}

console.log('Next.js security check passed: no vulnerable Next.js dependency found.');
