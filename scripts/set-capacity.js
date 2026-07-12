const mongoose = require('mongoose');
const AppSetting = require('../src/models/AppSetting');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/food');
  const result = await AppSetting.findOneAndUpdate(
    { key: 'default' },
    { $set: { defaultMenuItemCapacity: 20 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(JSON.stringify({ id: result._id, defaultMenuItemCapacity: result.defaultMenuItemCapacity }, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
