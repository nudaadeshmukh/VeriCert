import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDb = vi.fn();
vi.mock('../../src/lib/db/client.js', () => ({ getDb: () => getDb() }));

const { GET } = await import('../../app/api/health/route.js');

beforeEach(() => {
  getDb.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/health', () => {
  it('reports db "up" with 200 when the ping succeeds', async () => {
    getDb.mockResolvedValue({ command: vi.fn().mockResolvedValue({ ok: 1 }) });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      db: 'up',
      version: expect.stringMatching(/^\d+\.\d+\.\d+\+\w+$/),
    });
  });

  it('reports db "down" with 503 when the ping fails, without leaking the error', async () => {
    getDb.mockResolvedValue({
      command: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED cluster0.secret-host.mongodb.net')),
    });
    const res = await GET();
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ ok: false, db: 'down' });
    expect(text).not.toMatch(/ECONNREFUSED|secret-host/);
  });

  it('fails closed (503) when configuration is missing', async () => {
    getDb.mockRejectedValue(new Error('Missing required environment variable MONGODB_URI'));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe('down');
  });
});
