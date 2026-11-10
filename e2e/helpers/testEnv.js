// The database Playwright's server uses. Never the real one.
import fs from 'node:fs';
import path from 'node:path';

function fromEnvFile(name) {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
    return text
      .match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

if (!process.env.MONGODB_URI) process.env.MONGODB_URI = fromEnvFile('MONGODB_URI');
const base = process.env.E2E_DB_BASE ?? fromEnvFile('MONGODB_DB') ?? 'vericert';
export const TEST_DB = base.endsWith('_test') ? base : `${base}_test`;
export const OUTBOX = path.resolve(process.cwd(), 'tmp', 'mail-outbox.jsonl');
