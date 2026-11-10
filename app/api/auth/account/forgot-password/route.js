// POST /api/auth/account/forgot-password: see src/lib/auth/flows.js. Public (the proxy lets /api/auth/* through).
import { handleAccountPost } from '../../../../../src/lib/auth/accountRoute.js';
import { forgotPasswordFlow } from '../../../../../src/lib/auth/flows.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request) =>
  handleAccountPost(request, ({ db, ip, body }) => forgotPasswordFlow({ db, ip, email: body.email }));
