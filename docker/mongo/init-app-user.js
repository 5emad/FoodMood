// ایجاد کاربر اپ — فقط در init اول volume اجرا می‌شود
const appDb = process.env.MONGO_APP_DB || 'food_ordering';
const appUser = process.env.MONGO_APP_USER || 'foodapp';
const appPass = process.env.MONGO_APP_PASSWORD;

if (!appPass) {
  throw new Error('MONGO_APP_PASSWORD is required for init');
}

const target = db.getSiblingDB(appDb);
const existing = target.getUser(appUser);
if (!existing) {
  target.createUser({
    user: appUser,
    pwd: appPass,
    roles: [{ role: 'readWrite', db: appDb }],
  });
  print(`created app user ${appUser} on ${appDb}`);
} else {
  print(`app user already exists: ${appUser}`);
}
