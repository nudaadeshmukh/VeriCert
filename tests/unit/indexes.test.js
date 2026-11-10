import { describe, expect, it, vi } from 'vitest';
import { ensureIndexes, indexSpecs, parseRetentionDays } from '../../src/lib/db/indexes.js';

describe('parseRetentionDays', () => {
  it('defaults to 180 when unset or blank', () => {
    expect(parseRetentionDays(undefined)).toBe(180);
    expect(parseRetentionDays('')).toBe(180);
  });
  it('accepts whole numbers in range', () => {
    expect(parseRetentionDays('30')).toBe(30);
    expect(parseRetentionDays(' 365 ')).toBe(365);
  });
  it.each(['abc', '-5', '0', '1.5', '99999', '1e3'])('rejects %s instead of silently falling back', (v) => {
    expect(() => parseRetentionDays(v)).toThrow(/RESULT_RETENTION_DAYS/);
  });
});

describe('indexSpecs', () => {
  const specs = indexSpecs(180);
  const find = (collection, name) =>
    specs.find((s) => s.collection === collection && s.options.name === name);

  it('covers every index in the data model', () => {
    expect(find('runs', 'userId_createdAt').key).toEqual({ userId: 1, createdAt: -1 });
    expect(find('results', 'runId').key).toEqual({ runId: 1 });
    expect(find('results', 'userId_createdAt').key).toEqual({ userId: 1, createdAt: -1 });
    expect(find('results', 'candidateName_text').key).toEqual({ candidateName: 'text' });
  });
  it('sets TTLs from the retention period (runs, results) and fixed periods elsewhere', () => {
    expect(find('runs', 'createdAt_ttl').options.expireAfterSeconds).toBe(180 * 86400);
    expect(find('results', 'createdAt_ttl').options.expireAfterSeconds).toBe(180 * 86400);
    expect(find('audit_logs', 'createdAt_ttl').options.expireAfterSeconds).toBe(365 * 86400);
    expect(find('rate_limits', 'windowStart_ttl').options.expireAfterSeconds).toBe(3600);
  });
  it('turns off text-index stemming (personal names)', () => {
    expect(find('results', 'candidateName_text').options.default_language).toBe('none');
  });
  it('only indexes metadata fields, never certificate content', () => {
    const fields = specs.flatMap((s) => Object.keys(s.key));
    expect(new Set(fields)).toEqual(
      new Set([
        'userId',
        'createdAt',
        'runId',
        'candidateName',
        'windowStart',
        // Phase 5 (authentication): metadata only, no certificate content
        'key',
        'email',
        'sessionToken',
        'expires',
        'provider',
        'providerAccountId',
        'tokenHash',
        'type',
        'expiresAt',
      ]),
    );
  });

  it('Phase 5: accounts are unique per address (case-insensitive), sessions and tokens by their secret', () => {
    const find = (c, n) => specs.find((s) => s.collection === c && s.options.name === n);
    expect(find('users', 'email_unique').options).toMatchObject({
      unique: true,
      collation: { locale: 'en', strength: 2 },
    });
    expect(find('sessions', 'sessionToken_unique').options.unique).toBe(true);
    expect(find('email_tokens', 'tokenHash_unique').options.unique).toBe(true);
    expect(find('rate_limits', 'key_windowStart').options.unique).toBe(true);
    expect(find('accounts', 'provider_account_unique').key).toEqual({ provider: 1, providerAccountId: 1 });
  });
  it('Phase 5: expired sessions and tokens are removed at their own expiry time', () => {
    const find = (c, n) => specs.find((s) => s.collection === c && s.options.name === n);
    expect(find('sessions', 'expires_ttl').options.expireAfterSeconds).toBe(0);
    expect(find('email_tokens', 'expiresAt_ttl').options.expireAfterSeconds).toBe(0);
  });
});

function fakeDb({ failWith } = {}) {
  const createIndex = vi.fn(async (key, options) => {
    const err = failWith?.(options);
    if (err) throw err;
    return options.name;
  });
  const command = vi.fn(async () => ({ ok: 1 }));
  return { db: { collection: vi.fn(() => ({ createIndex })), command }, createIndex, command };
}

describe('ensureIndexes', () => {
  it('creates all indexes and is repeatable', async () => {
    const { db, createIndex } = fakeDb();
    const first = await ensureIndexes(db, { retentionDays: 180 });
    const second = await ensureIndexes(db, { retentionDays: 180 });
    expect(first).toHaveLength(indexSpecs(180).length);
    expect(second).toEqual(first);
    expect(createIndex).toHaveBeenCalledTimes(indexSpecs(180).length * 2);
  });

  it('updates a changed TTL in place with collMod', async () => {
    const ttl = 30 * 86400;
    const { db, command } = fakeDb({
      failWith: (o) =>
        o.name === 'createdAt_ttl' && o.expireAfterSeconds === ttl
          ? Object.assign(new Error('conflict'), { code: 85 })
          : null,
    });
    const report = await ensureIndexes(db, { retentionDays: 30 });
    expect(command).toHaveBeenCalledWith({
      collMod: 'runs',
      index: { name: 'createdAt_ttl', expireAfterSeconds: ttl },
    });
    expect(command).toHaveBeenCalledWith({
      collMod: 'results',
      index: { name: 'createdAt_ttl', expireAfterSeconds: ttl },
    });
    expect(report.filter((l) => l.startsWith('updated'))).toHaveLength(2);
  });

  it('does not hide other errors (fail closed)', async () => {
    const { db } = fakeDb({ failWith: () => Object.assign(new Error('auth failed'), { code: 18 }) });
    await expect(ensureIndexes(db, { retentionDays: 180 })).rejects.toThrow('auth failed');
  });

  it('does not treat a non-TTL conflict as updatable', async () => {
    const { db, command } = fakeDb({
      failWith: (o) => (o.name === 'runId' ? Object.assign(new Error('key conflict'), { code: 86 }) : null),
    });
    await expect(ensureIndexes(db, { retentionDays: 180 })).rejects.toThrow('key conflict');
    expect(command).not.toHaveBeenCalled();
  });
});
