// POST /api/auth/account/login: see src/lib/auth/flows.js. Public (the proxy lets /api/auth/* through).
import { handleAccountPost } from '../../../../../src/lib/auth/accountRoute.js';
import { loginFlow } from '../../../../../src/lib/auth/flows.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request) =>
  handleAccountPost(request, ({ db, ip, body }) =>
    loginFlow({ db, ip, email: body.email, password: body.password }),
  );
