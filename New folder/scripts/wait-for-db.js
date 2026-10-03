import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
const tries = Number(process.env.DB_WAIT_TRIES || 30);
const delay = Number(process.env.DB_WAIT_DELAY_MS || 2000);
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });

for (let i = 1; i <= tries; i++) {
  try {
    await pool.query('select 1');
    console.log('Database is reachable.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    if (i === tries) {
      await pool.end();
      console.error(`Database was not reachable after ${tries} attempts.`);
      console.error(err.message);
      process.exit(1);
    }
    console.log(`Waiting for database (${i}/${tries})...`);
    await new Promise(r => setTimeout(r, delay));
  }
}
