const Guest = require('../models/Guest');

function randomGuestCode(length = 4) {
  const digits = Math.max(4, Math.min(8, Number(length) || 4));
  const min = 10 ** (digits - 1);
  const max = (10 ** digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

async function generateUniqueGuestCode(length = 4) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = randomGuestCode(length);
    const exists = await Guest.exists({ guestCode: code });
    if (!exists) return code;
  }
  return randomGuestCode(length + 1);
}

module.exports = {
  randomGuestCode,
  generateUniqueGuestCode,
};
