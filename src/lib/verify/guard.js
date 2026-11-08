// Is POST /api/verify reachable at all?
//
// TEMPORARY (Phase 3): the endpoint has no authentication yet. Phase 5 MUST delete this guard and
// put `requireUser()` on the route instead (docs/progress.md records this). Until then:
//
//   - NODE_ENV !== "production"  (local `next dev`, Vitest): enabled.
//   - Vercel Preview: Vercel builds and runs Preview deployments with NODE_ENV=production, so the
//     plain NODE_ENV rule would block the Phase 3 live test there. It is enabled only when
//     VERIFY_DEV_ENDPOINT=1 AND VERCEL_ENV=preview.
//   - Production (VERCEL_ENV=production, or any other production run, such as `next start`): never.
//     Setting VERIFY_DEV_ENDPOINT on Production by mistake does NOT open it.
//
// Fail closed (rule 5): anything unexpected means "disabled".

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isVerifyEndpointEnabled(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  return env.VERIFY_DEV_ENDPOINT === '1' && env.VERCEL_ENV === 'preview';
}
