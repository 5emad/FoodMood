const crypto = require('crypto');

/**
 * Server-side image captcha.
 * - Text is drawn as an SVG made only of jittered rectangles (5×7 bitmap glyphs) — no <text>,
 *   so the answer cannot be read from the markup.
 * - Only a salted hash of the answer is kept in the server session; every challenge is single-use
 *   and expires after CAPTCHA_TTL_MS.
 * Ambiguous glyphs (0/O, 1/I/L, 2/Z, 5/S, 8/B) are excluded.
 */
const GLYPHS = {
  A: '.###.#...##...#######...##...##...#',
  C: '.#####....#....#....#....#.....####',
  D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####',
  F: '######....#....####.#....#....#....',
  H: '#...##...##...#######...##...##...#',
  J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#',
  M: '#...###.###.#.##.#.##...##...##...#',
  N: '#...###..##.#.##..###...##...##...#',
  P: '####.#...##...#####.#....#....#....',
  R: '####.#...##...#####.#.#..#..#.#...#',
  T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.###.###...#',
  X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..',
  3: '####.....#....#.###.....#....#####.',
  4: '...#...##..#.#.#..#.#####...#....#.',
  6: '.###.#....#....####.#...##...#.###.',
  7: '#####....#...#...#...#....#....#...',
  9: '.###.#...##...#.####....#....#.###.',
};

const ALPHABET = Object.keys(GLYPHS).join('');
const CAPTCHA_LENGTH = 5;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const MAX_ANSWER_LEN = 12;

const rand = (min, max) => min + Math.random() * (max - min);
const fx = (n) => n.toFixed(1);

function randomText(length = CAPTCHA_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function renderSvg(text) {
  const W = 150;
  const H = 44;
  const px = 3.6;
  const parts = [`<rect width="${W}" height="${H}" rx="8" fill="#dfe5f2"/>`];
  for (let i = 0; i < 5; i += 1) {
    parts.push(`<path d="M${fx(rand(0, 30))} ${fx(rand(0, H))} Q${fx(rand(40, 110))} ${fx(rand(0, H))} ${fx(rand(120, W))} ${fx(rand(0, H))}" stroke="#8e9bbd" stroke-width="${fx(rand(0.6, 1.4))}" fill="none"/>`);
  }
  [...text].forEach((ch, idx) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return;
    const cx = 18 + idx * 27 + rand(-2, 2);
    const cy = H / 2 + rand(-3, 3);
    const rot = rand(-18, 18);
    const color = ['#1f2d5c', '#2b3a7c', '#2b3a4c', '#3d2f1b'][crypto.randomInt(4)];
    const rects = [];
    for (let i = 0; i < 35; i += 1) {
      if (glyph[i] !== '#') continue;
      const x = (i % 5) * px - 2.5 * px + rand(-0.5, 0.5);
      const y = Math.floor(i / 5) * px - 3.5 * px + rand(-0.5, 0.5);
      rects.push(`<rect x="${fx(x)}" y="${fx(y)}" width="${fx(px + rand(-0.3, 0.4))}" height="${fx(px + rand(-0.3, 0.4))}" rx="0.8"/>`);
    }
    parts.push(`<g transform="translate(${fx(cx)} ${fx(cy)}) rotate(${fx(rot)})" fill="${color}">${rects.join('')}</g>`);
  });
  for (let i = 0; i < 45; i += 1) {
    parts.push(`<circle cx="${fx(rand(0, W))}" cy="${fx(rand(0, H))}" r="${fx(rand(0.4, 1.3))}" fill="#56648f" opacity="${fx(rand(0.3, 0.8))}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

function hashAnswer(answer, salt) {
  return crypto.createHmac('sha256', salt).update(String(answer).toUpperCase()).digest('hex');
}

/** Creates a fresh challenge bound to the caller's session and returns a data: URL image. */
function issueCaptcha(req, key = 'captcha') {
  if (!req.session) throw new Error('session unavailable');
  const text = randomText();
  const salt = crypto.randomBytes(16).toString('hex');
  req.session[key] = {
    id: crypto.randomUUID(),
    salt,
    hash: hashAnswer(text, salt),
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  };
  const svg = renderSvg(text);
  return {
    id: req.session[key].id,
    image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    expiresInSec: Math.round(CAPTCHA_TTL_MS / 1000),
  };
}

/**
 * Verifies and always consumes the current challenge (single-use, success or not).
 * Returns { ok: true } or { ok: false, message }.
 */
function verifyCaptcha(req, answerRaw, key = 'captcha') {
  const challenge = req.session?.[key];
  if (req.session) delete req.session[key];
  const answer = typeof answerRaw === 'string' ? answerRaw.trim().replace(/\s+/g, '') : '';
  if (!answer) return { ok: false, message: 'کد امنیتی را وارد کنید' };
  if (answer.length > MAX_ANSWER_LEN) return { ok: false, message: 'کد امنیتی نادرست است' };
  if (!challenge || !challenge.hash || Date.now() > Number(challenge.expiresAt || 0)) {
    return { ok: false, message: 'کد امنیتی منقضی شده است؛ کد جدید را وارد کنید' };
  }
  const expected = Buffer.from(String(challenge.hash), 'hex');
  const actual = Buffer.from(hashAnswer(answer, challenge.salt), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, message: 'کد امنیتی نادرست است' };
  }
  return { ok: true };
}

module.exports = {
  issueCaptcha,
  verifyCaptcha,
  renderSvg,
  randomText,
  CAPTCHA_TTL_MS,
};
