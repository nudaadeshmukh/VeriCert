// Build identity shown by /api/health. `VERCEL_GIT_COMMIT_SHA` is set by Vercel at build and
// run time; locally it is absent, so we report "dev".
import pkg from '../../package.json' with { type: 'json' };

export const APP_VERSION = pkg.version;
export const APP_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
/** `0.1.0+abc1234`, or `0.1.0+dev` locally. */
export const APP_VERSION_FULL = `${APP_VERSION}+${APP_COMMIT}`;
