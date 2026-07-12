const session = require('express-session');
const mongoose = require('mongoose');

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
    if (this.indexReady) return;
    await this.collection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.indexReady = true;
  }

  get(sid, callback) {
    this.collection().findOne({ _id: sid })
      .then((record) => {
        if (!record || record.expiresAt <= new Date()) return callback(null, null);
        return callback(null, record.session);
      })
      .catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    const expiresAt = new Date(Date.now() + (sessionData.cookie?.maxAge || this.ttlMs));
    this.ensureIndex()
      .then(() => this.collection().updateOne(
        { _id: sid },
        { $set: { session: sessionData, expiresAt } },
        { upsert: true },
      ))
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    const expiresAt = new Date(Date.now() + (sessionData.cookie?.maxAge || this.ttlMs));
    this.collection().updateOne({ _id: sid }, { $set: { expiresAt } })
      .then(() => callback(null))
      .catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.collection().deleteOne({ _id: sid })
      .then(() => callback(null))
      .catch(callback);
  }
}

module.exports = MongoSessionStore;
