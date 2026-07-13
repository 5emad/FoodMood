/**
 * Create or update a local admin account.
 * Usage: node scripts/create-admin.js <username> <password> [fullName]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { hashPassword, validatePasswordPolicy } = require('../src/helpers/SecurityHelper');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/food_ordering';

async function main() {
  const [username, password, fullName = 'مدیر سیستم'] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Usage: node scripts/create-admin.js <username> <password> [fullName]');
    process.exit(1);
  }

  if (!validatePasswordPolicy(password, { minLength: 8 })) {
    throw new Error('Password must be at least 8 chars and include letter and number.');
  }

  await mongoose.connect(MONGO_URI);

  const existing = await User.findOne({ username });
  if (existing) {
    existing.password = await hashPassword(password);
    existing.role = 'admin';
    existing.status = 'active';
    existing.fullName = fullName;
    existing.loginAttempts = 0;
    existing.lockUntil = null;
    existing.activeSessionId = null;
    await existing.save();
    console.log('Admin updated.');
  } else {
    await User.create({
      username,
      fullName,
      password: await hashPassword(password),
      role: 'admin',
      status: 'active',
      loginAttempts: 0,
      lockUntil: null,
    });
    console.log('Admin created.');
  }

  console.log('Username:', username);
  console.log('Password:', password);
  console.log('Role: admin');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
