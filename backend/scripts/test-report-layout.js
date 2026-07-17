require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const Food = require('../src/models/Food');
const User = require('../src/models/User');
const Week = require('../src/models/Week');
const DailyMenu = require('../src/models/DailyMenu');
const MenuItem = require('../src/models/MenuItem');
const Order = require('../src/models/Order');
const Day = require('../src/models/Day');
const { ensureCurrentWeek, ensureDailyMenus } = require('../src/services/WeekService');
const { buildReport } = require('../src/services/ReportService');
const { renderReportHtml } = require('../src/views/ReportPdfView');

const LONG_FOODS = [
  'چلوکباب کوبیده ممتاز با دورچین سالاد شیرازی و ماست موسیر و نوشابه خانواده',
  'خورشت قورمه‌سبزی مجلسی با گوشت تازه گوسفندی و برنج ایرانی دم‌پخت',
  'زرشک‌پلو با مرغ سرخ‌شده تازه همراه با سوپ جو و سالاد فصل و دسر میوه فصل',
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/food_ordering');

  const week = await ensureCurrentWeek();
  await ensureDailyMenus(week);
  const days = await Day.find().sort({ index: 1 }).lean();
  const dailyMenus = await DailyMenu.find({ weekId: week._id }).sort({ date: 1 }).lean();

  const foods = [];
  for (const name of LONG_FOODS) {
    let food = await Food.findOne({ name });
    if (!food) {
      food = await Food.create({ name, price: 185000 + foods.length * 15000, category: 'lunch' });
    }
    foods.push(food);
  }

  const admin = await User.findOne({ role: 'admin', status: 'active' })
    || await User.findOne({ role: 'user', status: 'active' });
  if (!admin) throw new Error('No active admin/user found for test orders');

  const menuItems = [];
  for (let i = 0; i < Math.min(foods.length, dailyMenus.length); i += 1) {
    const menu = dailyMenus[i];
    let item = await MenuItem.findOne({ dailyMenuId: menu._id, foodId: foods[i]._id });
    if (!item) {
      item = await MenuItem.create({ dailyMenuId: menu._id, foodId: foods[i]._id, maxCapacity: 50, isAvailable: true });
    }
    menuItems.push(item);
  }

  await Order.deleteMany({ userId: admin._id, weekId: week._id, orderUserName: /TEST-LAYOUT/ });
  for (const item of menuItems) {
    const menu = dailyMenus.find((m) => String(m._id) === String(item.dailyMenuId));
    await Order.create({
      userId: admin._id,
      orderUserName: `${admin.fullName || admin.username} TEST-LAYOUT`,
      orderUserDepartment: 'واحد تست گزارش',
      menuItemId: item._id,
      weekId: week._id,
      quantity: 1,
      totalPrice: foods.find((f) => String(f._id) === String(item.foodId))?.price || 200000,
      status: 'confirmed',
      orderDate: menu?.date || new Date(),
      items: [{ foodId: item.foodId, quantity: 1, price: 200000 }],
    });
  }

  const report = await buildReport(week.startDate, week.endDate);
  const html = renderReportHtml({
    type: 'week',
    title: week.name,
    reportNumber: 'TEST-001',
    organizationName: 'سامانه تست گزارش',
    range: {
      jalaliStart: 'تست',
      jalaliEnd: 'تست',
      start: week.startDate,
      end: week.endDate,
    },
    ...report,
  });

  const outDir = path.join(__dirname, '../dist/test-report');
  await fs.mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, 'weekly-report.html');
  await fs.writeFile(htmlPath, html, 'utf8');

  console.log('Test report data ready');
  console.log(`Admin: ${admin.username}`);
  console.log(`Foods: ${foods.length}`);
  console.log(`Confirmed orders: ${menuItems.length}`);
  console.log(`Report users: ${report.byUser.length}`);
  console.log(`HTML: ${htmlPath}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
