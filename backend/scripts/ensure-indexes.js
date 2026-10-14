const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../src/config/database');

const models = [
  require('../src/models/Announcement'),
  require('../src/models/AppSetting'),
  require('../src/models/Counter'),
  require('../src/models/DailyMenu'),
  require('../src/models/Day'),
  require('../src/models/Department'),
  require('../src/models/Food'),
  require('../src/models/FoodCategory'),
  require('../src/models/Guest'),
  require('../src/models/LdapProfile'),
  require('../src/models/MenuItem'),
  require('../src/models/Order'),
  require('../src/models/Payment'),
  require('../src/models/DiscountCode'),
  require('../src/models/SecurityLog'),
  require('../src/models/StatementDiscount'),
  require('../src/models/User'),
  require('../src/models/UserSession'),
  require('../src/models/Week'),
];

async function repairLegacyIndexes() {
  const UserSession = mongoose.model('UserSession');
  const indexes = await UserSession.collection.indexes();
  const expiresAtIndex = indexes.find((index) => index.name === 'expiresAt_1');
  if (expiresAtIndex && expiresAtIndex.expireAfterSeconds !== 0) {
    await mongoose.connection.db.command({
      collMod: UserSession.collection.name,
      index: {
        name: 'expiresAt_1',
        expireAfterSeconds: 0,
      },
    });
    console.log('Repaired TTL index: UserSession.expiresAt');
  }
}

async function disconnectQuietly() {
  mongoose.connection.removeAllListeners('disconnected');
  await mongoose.disconnect();
}

async function ensureIndexes() {
  await connectDB();
  await repairLegacyIndexes();

  for (const Model of models) {
    await Model.createIndexes();
    console.log(`Indexes ensured: ${Model.modelName}`);
  }

  await disconnectQuietly();
}

ensureIndexes().catch(async (error) => {
  console.error(error);
  try {
    await disconnectQuietly();
  } catch (_) {
    // Best-effort cleanup before exiting the maintenance script.
  }
  process.exit(1);
});
