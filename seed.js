require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./src/models/User');
const Food = require('./src/models/Food');
const Week = require('./src/models/Week');
const Order = require('./src/models/Order');
const Department = require('./src/models/Department');
const Day = require('./src/models/Day');
const DailyMenu = require('./src/models/DailyMenu');
const MenuItem = require('./src/models/MenuItem');
const Counter = require('./src/models/Counter');

const dayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

function startOfCurrentSaturday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysSinceSaturday = (now.getDay() + 1) % 7;
  now.setDate(now.getDate() - daysSinceSaturday);
  return now;
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/food_ordering');
  console.log('Connected to MongoDB');

  await Promise.all([
    User.deleteMany({}),
    Food.deleteMany({}),
    Week.deleteMany({}),
    Order.deleteMany({}),
    Department.deleteMany({}),
    Day.deleteMany({}),
    DailyMenu.deleteMany({}),
    MenuItem.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const [adminPass, userPass] = await Promise.all([
    bcrypt.hash('admin1234', 10),
    bcrypt.hash('user1234', 10),
  ]);

  const department = await Department.create({ name: 'واحد عمومی' });

  const [admin, user] = await User.insertMany([
    {
      username: 'admin',
      fullName: 'مدیر سیستم',
      email: 'admin@company.com',
      password: adminPass,
      phone: '09121234567',
      role: 'admin',
      status: 'active',
      departmentId: department._id,
    },
    {
      username: '09120000000',
      fullName: 'علی احمدی',
      email: 'ali@company.com',
      password: userPass,
      phone: '09120000000',
      role: 'user',
      status: 'active',
      departmentId: department._id,
    },
  ]);

  const start = startOfCurrentSaturday();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const week = await Week.create({
    name: 'هفته جاری',
    weekNumber: 1,
    startDate: start,
    endDate: end,
    status: 'active',
    isActive: true,
  });

  const days = await Day.insertMany(dayNames.map((name, index) => ({ name, index: index + 1 })));
  const dailyMenus = await DailyMenu.insertMany(days.map((day, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { weekId: week._id, dayId: day._id, date };
  }));

  const foods = await Food.insertMany([
    { name: 'چلوکباب کوبیده', description: 'کباب کوبیده با برنج ایرانی', price: 85000, category: 'lunch' },
    { name: 'قرمه سبزی', description: 'خورشت قرمه سبزی با برنج', price: 78000, category: 'lunch' },
    { name: 'جوجه کباب', description: 'جوجه کباب زعفرانی', price: 92000, category: 'lunch' },
    { name: 'سوپ جو', description: 'سوپ جو گرم', price: 38000, category: 'dinner' },
  ]);

  await MenuItem.insertMany(dailyMenus.slice(0, 5).flatMap((dailyMenu, dayIndex) => ([
    { dailyMenuId: dailyMenu._id, foodId: foods[dayIndex % foods.length]._id, maxCapacity: 50 },
    { dailyMenuId: dailyMenu._id, foodId: foods[(dayIndex + 1) % foods.length]._id, maxCapacity: 50 },
  ])));

  console.log('Seed completed');
  console.log('Admin: admin / admin1234');
  console.log('User: 09120000000 / user1234');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
