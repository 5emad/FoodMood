/**
 * Round-trip smoke test for BackupService (export → wipe marker → restore)
 * Usage: node backend/scripts/test-backup-roundtrip.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const {
  createBackupBuffer,
  readBackupBuffer,
  restoreBackup,
} = require('../src/services/BackupService');
const User = require('../src/models/User');
const Food = require('../src/models/Food');
const Department = require('../src/models/Department');
const FoodCategory = require('../src/models/FoodCategory');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/foodmood');

  const beforeUsers = await User.countDocuments();
  const beforeFoods = await Food.countDocuments();
  const beforeCats = await FoodCategory.countDocuments();
  console.log('before', { users: beforeUsers, foods: beforeFoods, categories: beforeCats });

  const { buffer, counts } = await createBackupBuffer('backup-test');
  console.log('backup bytes', buffer.length, 'counts', counts);

  const payload = readBackupBuffer(buffer);
  const sampleUser = (payload.data.users || [])[0];
  if (!sampleUser?.password) {
    throw new Error('FAIL: user password missing from backup payload');
  }
  console.log('sample user has password:', Boolean(sampleUser.password), 'len', sampleUser.password.length);

  // Marker: temporarily rename a department if any exist, then restore should bring it back
  const dept = await Department.findOne();
  let marker = null;
  if (dept) {
    marker = dept.name;
    dept.name = `__BACKUP_TEST_${Date.now()}__`;
    await dept.save();
    console.log('marked department', marker, '->', dept.name);
  }

  const result = await restoreBackup(payload);
  console.log('restore mode', result.mode, 'summary users/foods', result.summary.users, result.summary.foods);

  const afterUsers = await User.countDocuments();
  const afterFoods = await Food.countDocuments();
  const afterCats = await FoodCategory.countDocuments();
  const restoredUser = await User.findOne().select('+password').lean();
  if (!restoredUser?.password) throw new Error('FAIL: password missing after restore');

  if (marker) {
    const restoredDept = await Department.findById(dept._id).lean();
    if (restoredDept?.name !== marker) {
      throw new Error(`FAIL: department not restored (got ${restoredDept?.name})`);
    }
    console.log('department restored OK:', restoredDept.name);
  }

  console.log('after', { users: afterUsers, foods: afterFoods, categories: afterCats });
  if (afterUsers !== beforeUsers || afterFoods !== beforeFoods) {
    throw new Error('FAIL: counts mismatch after restore');
  }
  console.log('PASS: backup round-trip OK');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('FAIL:', e.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
