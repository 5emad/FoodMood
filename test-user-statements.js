const mongoose = require('mongoose');
const connectDB = require('./backend/src/config/database');
const { getSettingsLean } = require('./backend/src/services/SettingsService');

async function test() {
  require('dotenv').config();
  await connectDB();
  try {
    const settings = await getSettingsLean();
    console.log('Settings:', JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    mongoose.connection.close();
  }
}

test();
