/**
 * Download high-quality Iranian food images from Wikimedia Commons.
 * Run: node backend/scripts/download-portal-slide-images.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'uploads', 'portal-slides');
const USER_AGENT = 'FoodMoodPortal/1.7 (https://localhost; admin@foodmood.local)';

const FILES = {
  'morgh-torsh.jpg': 'File:Gilaki dishes.jpg',
  'ghormeh-sabzi.jpg': 'File:Ghormeh Sabzi.JPG',
  'fesenjan.jpg': 'File:Khoresht-e fesenjan.jpg',
  'chelow-kebab.jpg': 'File:Chelo Kabab Soltani Berlin Kourosh.jpg',
  'tahchin.jpg': 'File:Making Tahchin.jpg',
  'zereshk-polo.jpg': { pageid: 31381853 },
};

async function resolveByPageId(pageid) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&pageids=${pageid}&prop=imageinfo&iiprop=url&iiurlwidth=1920&format=json`;
  const json = JSON.parse(await fetchText(api));
  const page = Object.values(json.query.pages)[0];
  const info = page.imageinfo?.[0];
  if (!info) throw new Error(`No imageinfo for page ${pageid}`);
  return info.thumburl || info.url;
}

async function resolveSource(source) {
  if (typeof source === 'string') return resolveImageUrl(source);
  if (source?.pageid) return resolveByPageId(source.pageid);
  throw new Error('Invalid image source');
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const size = fs.statSync(dest).size;
          resolve(size);
        });
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function resolveImageUrl(fileTitle) {
  const titles = encodeURIComponent(fileTitle);
  const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${titles}&prop=imageinfo&iiprop=url&iiurlwidth=1920&format=json`;
  const json = JSON.parse(await fetchText(api));
  const page = Object.values(json.query.pages)[0];
  if (page.missing !== undefined) throw new Error(`File not found: ${fileTitle}`);
  const info = page.imageinfo?.[0];
  if (!info) throw new Error(`No imageinfo for ${fileTitle}`);
  return info.thumburl || info.url;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const old of fs.readdirSync(OUT_DIR)) {
    if (old.endsWith('.svg')) fs.unlinkSync(path.join(OUT_DIR, old));
  }

  for (const [filename, source] of Object.entries(FILES)) {
    const dest = path.join(OUT_DIR, filename);
    try {
      const url = await resolveSource(source);
      const label = typeof source === 'string' ? source : `pageid:${source.pageid}`;
      const size = await downloadBinary(url, dest);
      console.log(`OK ${filename} <- ${label} (${size} bytes)`);
    } catch (err) {
      console.error(`FAIL ${filename}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main();
