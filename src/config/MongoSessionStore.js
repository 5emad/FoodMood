const session = require('express-session');
const mongoose = require('mongoose');

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

class MongoSessionStore extends session.Store {
  constructor({ collectionName = 'sessions', ttlMs = 8 * 60 * 60 * 1000 } = {}) {
    super();
    this.collectionName = collectionName;
    this.ttlMs = ttlMs;
    this.indexReady = false;
  }

  collection() {
    return mongoose.connection.collection(this.collectionName);
  }

  async ensureIndex() {
    if (this.indexReady || !isDbReady()) return;
    await this.collection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.indexReady = true;
  }

  get(sid, callback) {
    if (!isDbReady()) return callback(null, null);
    this.collection().findOne({ _id: sid })
      .then((record) => {
        if (!record || record.expiresAt <= new Date()) return callback(null, null);
        return callback(null, record.session);
      })
      .catch(() => callback(null, null));
  }

  set(sid, sessionData, callback = () => {}) {
    if (!isDbReady()) return callback(null);
    const expiresAt = new Date(Date.now() + (sessionData.cookie?.maxAge || this.ttlMs));
    this.ensureIndex()
      .then(() => this.collection().updateOne(
        { _id: sid },
        { $set: { session: sessionData, expiresAt } },
        { upsert: true },
      ))
      .then(() => callback(null))
      .catch(() => callback(null));
  }

  touch(sid, sessionData, callback = () => {}) {
    if (!isDbReady()) return callback(null);
    const expiresAt = new Date(Date.now() + (sessionData.cookie?.maxAge || this.ttlMs));
    this.collection().updateOne({ _id: sid }, { $set: { expiresAt } })
      .then(() => callback(null))
      .catch(() => callback(null));
  }

  destroy(sid, callback = () => {}) {
    if (!isDbReady()) return callback(null);
    this.collection().deleteOne({ _id: sid })
      .then(() => callback(null))
      .catch(() => callback(null));
  }
}

module.exports = MongoSessionStore;
