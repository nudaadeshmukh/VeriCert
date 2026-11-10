import { describe, expect, it } from 'vitest';
import {
  allowedDomain,
  evaluateGoogleProfile,
  isAllowedEmail,
  normaliseEmail,
} from '../../src/lib/auth/domain.js';
import { safeNext } from '../../src/lib/auth/redirect.js';

const D = 'pict.edu';
const allowed = (e, strict = false) => isAllowedEmail(e, { domain: D, strict });

describe('@pict.edu rule', () => {
  it.each([
    'staff.member@pict.edu',
    'Staff.Member@PICT.EDU',
    'a.b-c_d@pict.edu',
    '  staff.member@pict.edu  ',
    'sb+alias@pict.edu',
  ])('accepts %j', (e) => expect(allowed(e)).toBe(true));
  it.each([
    'x@pict.edu.x.com',
    'x@notpict.edu',
    'x@sub.pict.edu',
    'pict.edu@gmail.com',
    'x@pict.edu@evil.com',
    'x@@pict.edu',
    'x@pict.edu.',
    'x@pict,edu',
    'x y@pict.edu',
    'x@pict.edu\nevil.com',
    '@pict.edu',
    'pict.edu',
    '',
    'x@ріct.edu', // Cyrillic homoglyph
    'x@pict.edu evil.com',
  ])('rejects %j', (e) => expect(allowed(e)).toBe(false));
  it('rejects non-strings', () => {
    for (const v of [null, undefined, 5, {}, []]) expect(allowed(v)).toBe(false);
  });
  it('normalises to a canonical lower-case address', () => {
    expect(normaliseEmail('  A@PICT.edu ')).toBe('a@pict.edu');
    expect(normaliseEmail('nope')).toBeNull();
  });
  it('fails closed without ALLOWED_EMAIL_DOMAIN', () => {
    expect(() => allowedDomain({})).toThrow();
  });
});

describe('evaluateGoogleProfile', () => {
  it('needs email_verified === true', () => {
    expect(evaluateGoogleProfile({ email: 'a@pict.edu', email_verified: true }, D)).toEqual({
      ok: true,
      email: 'a@pict.edu',
    });
    for (const v of [false, undefined, 'true', 1]) {
      expect(evaluateGoogleProfile({ email: 'a@pict.edu', email_verified: v }, D)).toMatchObject({
        ok: false,
        reason: 'email_not_verified',
      });
    }
  });
  it('refuses other domains and a missing email', () => {
    expect(evaluateGoogleProfile({ email: 'outsider@example.com', email_verified: true }, D)).toMatchObject({
      ok: false,
      reason: 'domain_not_allowed',
    });
    expect(evaluateGoogleProfile({ email_verified: true }, D)).toMatchObject({
      ok: false,
      reason: 'no_email',
    });
    expect(evaluateGoogleProfile(null, D).ok).toBe(false);
  });
  it('lower-cases the address', () => {
    expect(evaluateGoogleProfile({ email: 'A@PICT.EDU', email_verified: true }, D).email).toBe('a@pict.edu');
  });
});

describe('safeNext (no open redirect)', () => {
  it.each(['/dashboard', '/history?page=2', '/admin/users'])('keeps %s', (p) => expect(safeNext(p)).toBe(p));
  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    '/login',
    '/api/auth/signin',
    '/dashboard\r\nSet-Cookie: x=1',
    undefined,
    '',
  ])('falls back for %j', (p) => expect(safeNext(p)).toBe('/dashboard'));
});
