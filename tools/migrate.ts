import { createDatabase } from '../packages/database/src/index';

if (!process.env.DATABASE_URL)
  throw new Error(
    'Set DATABASE_URL to the PostgreSQL database to migrate. Local stores migrate automatically.',
  );
const db = await createDatabase({ url: process.env.DATABASE_URL });
await db.close();
console.log('Database schema is current.');
