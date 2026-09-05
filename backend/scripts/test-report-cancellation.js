const assert = require('node:assert/strict');
const { test } = require('node:test');
const Order = require('../src/models/Order');
const DailyMenu = require('../src/models/DailyMenu');
const Week = require('../src/models/Week');
const User = require('../src/models/User');
const LdapProfile = require('../src/models/LdapProfile');
const FoodCategory = require('../src/models/FoodCategory');
const MenuItem = require('../src/models/MenuItem');
const OrderController = require('../src/controllers/OrderController');
const { buildReport, resolveReportRange, getAvailableReportMonths, sumOwnerTotalsInRange } = require('../src/services/ReportService');

function query(value) {
  return {
    select() { return this; }, sort() { return this; }, populate() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

for (const isActive of [true, false]) {
  test(`admin cancellation removes confirmed orders from ${isActive ? 'active' : 'inactive'} week reports`, async (t) => {
    const date = new Date('2026-08-22T12:00:00+03:30');
    const week = { _id: 'week', startDate: date, endDate: date, isActive };
    const food = { _id: 'food', name: 'Meal', category: 'main' };
    const orders = ['confirmed', 'confirmed', 'pending', 'cancelled', 'ready', 'completed'].map((status, index) => ({
      _id: String(index), orderNumber: 100 + index, status, quantity: 1, totalPrice: 100,
      orderDate: date, dailyMenuId: { _id: 'day', date },
      userId: { _id: 'user', username: 'tester', fullName: 'Test User' },
      menuItemId: { _id: 'menu', foodId: food },
      items: [{ foodId: food, quantity: 1, price: 100 }],
      async save() {},
    }));
    t.mock.method(Week, 'findById', () => query(week));
    t.mock.method(Week, 'findOne', () => query(week));
    t.mock.method(DailyMenu, 'find', () => query([{ _id: 'day' }]));
    t.mock.method(User, 'find', () => query([]));
    t.mock.method(LdapProfile, 'find', () => query([]));
    t.mock.method(FoodCategory, 'find', () => query([{ key: 'main', name: 'Main' }]));
    t.mock.method(MenuItem, 'updateOne', async () => ({ modifiedCount: 1 }));
    t.mock.method(Order, 'findOne', ({ orderNumber }) => query(orders.find((o) => o.orderNumber === orderNumber)));
    t.mock.method(Order, 'find', (filter) => {
      assert.deepEqual(filter.status, { $in: ['confirmed'] });
      return query(orders.filter((o) => filter.status.$in.includes(o.status)));
    });
    t.mock.method(Order, 'aggregate', async (pipeline) => {
      assert.deepEqual(pipeline[0].$match.status, { $in: ['confirmed'] });
      const count = orders.filter((o) => o.status === 'confirmed').length;
      if (!count) return [];
      return pipeline.some((stage) => stage.$lookup)
        ? [{ _id: '2026-08-22', count }]
        : [{ _id: { userId: 'user' }, totalPrice: count * 100, mealCount: count }];
    });
    const { range } = await resolveReportRange(isActive ? {} : { weekId: 'week' });
    async function check(expected) {
      for (const mode of ['full', 'prep', 'finance']) {
        const report = await buildReport(range.start, range.end, { mode });
        assert.equal(report.totals.totalOrders, expected, mode);
        assert.equal(report.totals.totalMeals, expected, mode);
        assert.equal(report.totals.totalPrice, expected * 100, mode);
        assert.equal(report.totals.statuses.cancelled, undefined);
        if (mode !== 'finance') assert.equal(report.prepTotals.totalMeals, expected);
        if (mode !== 'prep') assert.equal(report.byUser.reduce((sum, row) => sum + row.total, 0), expected);
      }
      const months = await getAvailableReportMonths();
      assert.equal(months.reduce((sum, month) => sum + month.count, 0), expected);
      const totals = await sumOwnerTotalsInRange(range.start, range.end);
      assert.equal(totals.reduce((sum, row) => sum + row.mealCount, 0), expected);
    }
    await check(2);
    for (const orderNumber of [100, 101]) {
      let response;
      await OrderController.adminCancel(
        { params: { id: String(orderNumber) } },
        { json: (data) => { response = data; } },
        (error) => { throw error; },
      );
      assert.equal(response.success, true);
      assert.equal(orders[orderNumber - 100].status, 'cancelled');
      await check(101 - orderNumber);
    }
  });
}
