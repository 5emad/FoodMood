const Counter = require('../models/Counter');

const COUNTER_ID = 'reportNumber';
const PREFIX = 'FM-';
const PAD_LEN = 6;
// First issued number will be FM-417006 (seq starts at 417005, then $inc).
const INITIAL_SEQ = 417005;

async function nextReportNumber() {
  await Counter.updateOne(
    { _id: COUNTER_ID },
    { $setOnInsert: { seq: INITIAL_SEQ } },
    { upsert: true }
  );

  const counter = await Counter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true }
  );

  return `${PREFIX}${String(counter.seq).padStart(PAD_LEN, '0')}`;
}

module.exports = { nextReportNumber };
