/**
 * Superadmin maintenance.
 * Usage:
 *   node scripts/super-admin.js create <username> <password>
 *   node scripts/super-admin.js reset-token <username>
 *   node scripts/super-admin.js unlock <username>
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { hashPassword, hashSensitiveToken } = require('../src/helpers/SecurityHelper');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/food_ordering';

function strongToken() {
  return [
    crypto.randomBytes(18).toString('base64url'),
    crypto.randomBytes(18).toString('base64url'),
    crypto.randomBytes(18).toString('base64url'),
  ].join('.');
}

function validatePassword(pw) {
  return typeof pw === 'string'
    && pw.length >= 12
    && /[a-z]/i.test(pw)
    && /[0-9]/.test(pw)
    && /[^a-zA-Z0-9]/.test(pw);
}

async function main() {
  const [cmd, username, password] = process.argv.slice(2);
  if (!['create', 'reset-token', 'unlock'].includes(cmd) || !username) {
    console.log('Usage: node scripts/super-admin.js create <username> <password>');
    console.log('       node scripts/super-admin.js reset-token <username>');
    console.log('       node scripts/super-admin.js unlock <username>');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);

  if (cmd === 'create') {
    if (!validatePassword(password)) {
      throw new Error('Password must be at least 12 chars and include letter, number, and symbol.');
    }
    const token = strongToken();
    const existing = await User.findOne({ username });
    if (existing) throw new Error('Username already exists.');
    await User.create({
      username,
      fullName: 'سوپر ادمین',
      password: await hashPassword(password),
      role: 'superadmin',
      status: 'active',
      superTokenHash: hashSensitiveToken(token),
      superTokenCreatedAt: new Date(),
      loginAttempts: 0,
      lockUntil: null,
    });
    console.log('Superadmin created.');
    console.log('Username:', username);
    console.log('Password:', password);
    console.log('Second-factor token:', token);
    console.log('Store this token now. It is not recoverable from the database.');
  }

  if (cmd === 'reset-token') {
    const user = await User.findOne({ username }).select('+superTokenHash');
    if (!user || user.role !== 'superadmin') throw new Error('Superadmin not found.');
    const token = strongToken();
    user.superTokenHash = hashSensitiveToken(token);
    user.superTokenCreatedAt = new Date();
    user.superTokenLastUsedAt = null;
    user.activeSessionId = null;
    await user.save();
    console.log('Superadmin token reset.');
    console.log('Username:', username);
    console.log('Second-factor token:', token);
    console.log('Store this token now. It is not recoverable from the database.');
  }

  if (cmd === 'unlock') {
    const user = await User.findOne({ username });
    if (!user) throw new Error('User not found.');
    user.loginAttempts = 0;
    user.lockUntil = null;
    user.status = 'active';
    await user.save();
    console.log('User unlocked:', username);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
