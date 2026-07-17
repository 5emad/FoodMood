const mongoose = require('mongoose');

const daySchema = new mongoose.Schema({
  index: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 7,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
});

module.exports = mongoose.model('Day', daySchema);
