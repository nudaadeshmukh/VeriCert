// Auth.js route handler: Google sign-in, callback, sign-out, session. Public by design (the proxy lets /api/auth/* through).
import { handlers } from '../../../../src/lib/auth/auth.js';

export const { GET, POST } = handlers;
