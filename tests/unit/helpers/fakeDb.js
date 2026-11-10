// A small in-memory stand-in for the MongoDB operations the auth code uses (no network, no real database).
// Supported: insertOne (with unique indexes), findOne, find().toArray(), updateOne ($set, $unset, $inc, upsert), deleteMany,
// findOneAndUpdate, findOneAndDelete, countDocuments. Filters: equality (ObjectId and Date aware; `null` also matches a missing
// field, like MongoDB), `$gt`, `$exists`.
import { ObjectId } from 'mongodb';

const same = (a, b) => {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
};

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$gt') return value instanceof Date ? value.getTime() > arg.getTime() : value > arg;
        if (op === '$exists') return (value !== undefined) === arg;
        throw new Error(`fakeDb: unsupported operator ${op}`);
      });
    }
    if (cond === null) return value === null || value === undefined;
    return same(value, cond);
  });
}

class Collection {
  constructor(name, db) {
    this.name = name;
    this.db = db;
    this.docs = [];
  }

  #dupe(doc) {
    for (const keys of this.db.uniques.get(this.name) ?? []) {
      const clash = this.docs.some(
        (d) => d !== doc && keys.every((k) => same(d[k], doc[k]) && doc[k] !== undefined),
      );
      if (clash) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
  }

  async insertOne(doc) {
    this.db.failIf?.(this.name, 'insertOne');
    const copy = { _id: new ObjectId(), ...doc };
    this.#dupe(copy);
    this.docs.push(copy);
    return { insertedId: copy._id };
  }

  async findOne(filter = {}) {
    this.db.failIf?.(this.name, 'findOne');
    return this.docs.find((d) => matches(d, filter)) ?? null;
  }

  find(filter = {}) {
    return { toArray: async () => this.docs.filter((d) => matches(d, filter)) };
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  #apply(doc, update) {
    if (Array.isArray(update))
      throw new Error('fakeDb: pipeline updates are not supported (the code must not use them)');
    for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
    for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
    for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
  }

  async updateOne(filter, update, { upsert = false } = {}) {
    this.db.failIf?.(this.name, 'updateOne');
    let doc = this.docs.find((d) => matches(d, filter));
    if (!doc && upsert) {
      doc = {
        _id: new ObjectId(),
        ...Object.fromEntries(
          Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v instanceof Date),
        ),
      };
      this.#apply(doc, update);
      this.#dupe(doc);
      this.docs.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    this.#apply(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(filter, update, { upsert = false, returnDocument = 'before' } = {}) {
    this.db.failIf?.(this.name, 'findOneAndUpdate');
    const existing = this.docs.find((d) => matches(d, filter));
    const before = existing ? { ...existing } : null;
    await this.updateOne(filter, update, { upsert });
    const after = this.docs.find((d) => matches(d, filter)) ?? null;
    return returnDocument === 'after' ? after : before;
  }

  async findOneAndDelete(filter) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i < 0) return null;
    return this.docs.splice(i, 1)[0];
  }

  async deleteMany(filter = {}) {
    const keep = this.docs.filter((d) => !matches(d, filter));
    const deletedCount = this.docs.length - keep.length;
    this.docs = keep;
    return { deletedCount };
  }
}

/** @returns {import('mongodb').Db & { all: (name: string) => any[], uniques: Map<string, string[][]>, failIf?: Function }} */
export function fakeDb() {
  const collections = new Map();
  const db = {
    uniques: new Map([
      ['users', [['email']]],
      ['rate_limits', [['key', 'windowStart']]],
      ['email_tokens', [['tokenHash']]],
      ['sessions', [['sessionToken']]],
    ]),
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Collection(name, db));
      return collections.get(name);
    },
    all: (name) => db.collection(name).docs,
  };
  return /** @type {any} */ (db);
}
