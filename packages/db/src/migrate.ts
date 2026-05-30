import fs from 'fs';
import path from 'path';
import { getPool } from './client';

export async function runMigrations(): Promise<void> {
  const pool  = getPool();
  const files = ['schema.sql', 'triggers.sql'];
  console.log('[db] Running migrations...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`[db] Migration file not found, skipping: ${file}`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf-8');
      await client.query(sql);
      console.log(`[db] Applied: ${file}`);
    }
    await client.query('COMMIT');
    console.log('[db] Migrations complete.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[db] Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
