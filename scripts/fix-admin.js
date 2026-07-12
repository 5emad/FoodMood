/**
 * Admin account diagnostic and repair tool.
 * Usage:
 *   node scripts/fix-admin.js              — show admin status
 *   node scripts/fix-admin.js reset        — unlock account + reset failed attempts
 *   node scripts/fix-admin.js resetpw <newpassword>  — set new password
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/food_ordering';

async function main() {
  const arg = process.argv[2];
  const newPw = process.argv[3];

  await mongoose.connect(MONGO_URI);
  console.log('✔ Connected to MongoDB:', MONGO_URI);

  // Inline schema to avoid circular deps with SecurityHelper
  const User = mongoose.model('User', new mongoose.Schema({
    username:      String,
    email:         String,
    fullName:      String,
    password:      String,
    role:          String,
    status:        String,
    ldapUser:      Boolean,
    loginAttempts: Number,
    lockUntil:     Date,
    activeSessionId: String,
  }, { strict: false }));

  const admins = await User.find({ role: 'admin' }).lean();

  if (!admins.length) {
    console.log('⚠ هیچ حساب ادمینی پیدا نشد.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n═══════ وضعیت حساب‌های ادمین ═══════');
  for (const a of admins) {
    const locked = a.lockUntil && new Date(a.lockUntil) > new Date();
    const minLeft = locked ? Math.ceil((new Date(a.lockUntil) - Date.now()) / 60000) : 0;
    console.log(`
username       : ${a.username}
email          : ${a.email || '—'}
fullName       : ${a.fullName}
status         : ${a.status}
ldapUser       : ${a.ldapUser || false}
loginAttempts  : ${a.loginAttempts || 0}
lockUntil      : ${a.lockUntil ? new Date(a.lockUntil).toLocaleString('fa-IR') : '—'} ${locked ? `(قفل — ${minLeft} دقیقه)` : ''}
activeSessionId: ${a.activeSessionId || 'null'}
`);
  }

  if (arg === 'reset') {
    const res = await User.updateMany(
      { role: 'admin' },
      { $set: { loginAttempts: 0, lockUntil: null, status: 'active' } }
    );
    console.log(`✔ قفل حساب ادمین برداشته شد. (${res.modifiedCount} حساب آپدیت شد)`);
  }

  if (arg === 'resetpw' && newPw) {
    const { hashPassword, validatePasswordPolicy } = require('../src/helpers/SecurityHelper');

    if (!validatePasswordPolicy(newPw, { minLength: 8 })) {
      console.error('✘ رمز جدید باید حداقل 8 کاراکتر و شامل حرف و عدد باشد.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const hash = await hashPassword(newPw);

    const res = await User.updateMany(
      { role: 'admin' },
      { $set: { password: hash, loginAttempts: 0, lockUntil: null, status: 'active', activeSessionId: null } }
    );
    console.log(`✔ رمز عبور همه ادمین‌ها تغییر کرد. (${res.modifiedCount} حساب)`);
    console.log(`  رمز جدید: ${newPw}`);
  }

  if (!arg) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('برای برداشتن قفل:       node scripts/fix-admin.js reset');
    console.log('برای تغییر رمز:          node scripts/fix-admin.js resetpw NewPass1234');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('خطا:', err.message);
  process.exit(1);
});
