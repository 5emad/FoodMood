const mongoose = require('mongoose');
const Counter = require('./Counter');

const orderItemSchema = new mongoose.Schema({
  foodId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Food',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    default: 1,
  },
  price: {
    type: Number,
    required: true,
  },
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: Number,
    unique: true,
    sparse: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  ldapUsername: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    default: null,
    index: true,
  },
  orderUserName: {
    type: String,
    trim: true,
    default: null,
  },
  orderUserDepartment: {
    type: String,
    trim: true,
    default: null,
  },
  menuItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    default: null,
  },
  dailyMenuId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DailyMenu',
    default: null,
    index: true,
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
  totalPrice: {
    type: Number,
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'ready', 'completed', 'cancelled'],
    default: 'pending',
  },
  weekId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Week',
  },
  items: [orderItemSchema],
  orderDate: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// یک رزرو فعال به ازای هر کاربر/مهمان در هر روز
orderSchema.index(
  { userId: 1, dailyMenuId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: 'objectId' },
      dailyMenuId: { $type: 'objectId' },
      status: { $ne: 'cancelled' },
    },
  },
);
orderSchema.index(
  { ldapUsername: 1, dailyMenuId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      ldapUsername: { $type: 'string' },
      dailyMenuId: { $type: 'objectId' },
      status: { $ne: 'cancelled' },
    },
  },
);
orderSchema.index(
  { guestId: 1, dailyMenuId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      guestId: { $type: 'objectId' },
      dailyMenuId: { $type: 'objectId' },
      status: { $ne: 'cancelled' },
    },
  },
);
orderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

orderSchema.pre('validate', async function(next) {
  try {
    if (!this.isNew || this.orderNumber) return next();

    await Counter.updateOne(
      { _id: 'orderNumber' },
      { $setOnInsert: { seq: 99 } },
      { upsert: true }
    );

    const counter = await Counter.findOneAndUpdate(
      { _id: 'orderNumber' },
      { $inc: { seq: 1 } },
      { new: true }
    );
    this.orderNumber = counter.seq;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Order', orderSchema);
