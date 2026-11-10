// POST /api/auth/account/verify-email: see src/lib/auth/flows.js. Public (the proxy lets /api/auth/* through).
import { handleAccountPost } from '../../../../../src/lib/auth/accountRoute.js';
import { verifyEmailFlow } from '../../../../../src/lib/auth/flows.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request) =>
  handleAccountPost(request, ({ db, ip, body }) => verifyEmailFlow({ db, ip, token: body.token }));
