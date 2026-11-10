// User accounts for the credentials flow, on the Auth.js `users` collection (the adapter reads and writes the same documents).
//
// Document: { _id, email (lower case, unique), name, image, emailVerified: Date | null,
//             passwordHash?, disabled: boolean, createdAt, lastLoginAt }.
// `role` is NOT stored as an authority: access.js derives it from ADMIN_EMAILS on every request.
/** @param {import('mongodb').Db} db */
const users = (db) => db.collection('users');

/**
 * @param {import('mongodb').Db} db
 * @param {string} email canonical (normaliseEmail)
 */
export function findUserByEmail(db, email) {
  return users(db).findOne({ email });
}

/**
 * Create an UNVERIFIED credentials account. Returns null if the address already has an account (the unique index decides, so two
 * simultaneous signups cannot both win).
 * @param {import('mongodb').Db} db
 * @param {{ email: string, passwordHash: string, now?: Date }} o
 */
export async function createCredentialsUser(db, { email, passwordHash, now = new Date() }) {
  try {
    const r = await users(db).insertOne({
      email,
      name: null,
      image: null,
      emailVerified: null,
      passwordHash,
      disabled: false,
      createdAt: now,
      lastLoginAt: null,
    });
    return { _id: r.insertedId, email };
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * Set a password and mark the address verified (a token from the mailbox proves ownership). Also ends every existing session of
 * the account: whoever was signed in with the old password is signed out.
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 * @param {{ passwordHash: string, now?: Date }} o
 */
export async function setPasswordAndVerify(db, userId, { passwordHash, now = new Date() }) {
  const r = await users(db).updateOne({ _id: userId }, { $set: { passwordHash } });
  await markEmailVerified(db, userId, now);
  await deleteSessionsForUser(db, userId);
  return r.matchedCount === 1;
}

/**
 * Mark the address verified (the verification link was opened). Idempotent: an address verified earlier keeps its first date.
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 */
export async function markEmailVerified(db, userId, now = new Date()) {
  await users(db).updateOne({ _id: userId, emailVerified: null }, { $set: { emailVerified: now } });
}

/**
 * Replace the password of an UNVERIFIED signup (the same person signing up again). A verified account is never touched.
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 * @param {string} passwordHash
 */
export function replaceUnverifiedPassword(db, userId, passwordHash) {
  return users(db).updateOne({ _id: userId, emailVerified: null }, { $set: { passwordHash } });
}

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 */
export function deleteSessionsForUser(db, userId) {
  return db.collection('sessions').deleteMany({ userId });
}

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 */
export function recordLogin(db, userId, now = new Date()) {
  return users(db).updateOne({ _id: userId }, { $set: { lastLoginAt: now } });
}

/**
 * Pre-hijack defence: a Google sign-in for an address that already has an UNVERIFIED credentials signup removes that signup's
 * password. (Otherwise someone could sign up with a colleague's address and a password they know, then wait for the colleague to
 * sign in with Google and be linked to the account.) Returns whether a password was removed.
 * @param {import('mongodb').Db} db
 * @param {string} email
 */
export async function dropUnverifiedPassword(db, email, now = new Date()) {
  const r = await users(db).updateOne(
    { email, emailVerified: null, passwordHash: { $exists: true } },
    { $unset: { passwordHash: '' }, $set: { emailVerified: now } },
  );
  return r.modifiedCount === 1;
}
