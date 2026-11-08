import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/smoke-nptel.mjs'), 'utf8');

describe('scripts/smoke-nptel.mjs never exposes the Vercel bypass secret', () => {
  it('uses the secret to set the x-vercel-protection-bypass request header', () => {
    expect(src).toMatch(/'x-vercel-protection-bypass': bypass/);
  });
  it('never passes the secret (or the headers object) to console output', () => {
    for (const line of src.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))) {
      expect(line).not.toMatch(/\bbypass\b(?!-)|BYPASS_SECRET|headers/i);
    }
    expect(src).not.toMatch(/JSON\.stringify\([^)]*headers/);
  });
  it('is read from the environment, never hardcoded', () => {
    expect(src).toMatch(/process\.env\.VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(src).not.toMatch(/bypass\s*=\s*['"`]/);
  });
});
