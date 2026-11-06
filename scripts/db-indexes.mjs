// `npm run db:indexes`: create all indexes. Loads `.env` via `node --env-file=.env`.
import { getClientPromise, getDb } from '../src/lib/db/client.js';
import { ensureIndexes } from '../src/lib/db/indexes.js';

try {
  const db = await getDb();
  const report = await ensureIndexes(db);
  console.log(report.join('\n'));
  console.log(`\n${report.length} indexes ensured on database "${db.databaseName}".`);
  const client = await getClientPromise();
  await client.close();
} catch (err) {
  // Local CLI: the message helps (auth failed, DNS, network) and never contains the password.
  console.error(`db:indexes failed: ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
  process.exitCode = 1;
  process.exit();
}
