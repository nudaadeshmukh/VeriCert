import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getClientPromise, getDb } from '../../src/lib/db/client.js';

const saved = { uri: process.env.MONGODB_URI, db: process.env.MONGODB_DB };

beforeEach(() => {
  globalThis._mongoClientPromise = undefined;
});
afterEach(() => {
  if (saved.uri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = saved.uri;
  if (saved.db === undefined) delete process.env.MONGODB_DB;
  else process.env.MONGODB_DB = saved.db;
});

describe('db client fails closed', () => {
  it('throws when MONGODB_URI is missing', () => {
    delete process.env.MONGODB_URI;
    expect(() => getClientPromise()).toThrow(/MONGODB_URI/);
  });

  it('throws when MONGODB_URI is blank', () => {
    process.env.MONGODB_URI = '   ';
    expect(() => getClientPromise()).toThrow(/MONGODB_URI/);
  });

  it('does not cache anything when configuration is missing', () => {
    delete process.env.MONGODB_URI;
    expect(() => getClientPromise()).toThrow();
    expect(globalThis._mongoClientPromise).toBeUndefined();
  });

  it('refuses to guess a database name', async () => {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/';
    delete process.env.MONGODB_DB;
    await expect(getDb()).rejects.toThrow(/MONGODB_DB/);
  });
});
