require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mirror = require('../src/postgres-mirror');

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  process.env.PG_MIRROR_ENABLED = 'true';

  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '..', 'db.json');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`db.json not found: ${dbPath}`);
  }

  const raw = fs.readFileSync(dbPath, 'utf8');
  const snapshot = JSON.parse(raw);

  await mirror.init();
  const result = await mirror.syncSnapshot(snapshot, 'manual_migration');
  console.log('[migration] result:', result);

  await mirror.close();
}

run().catch(async (error) => {
  console.error('[migration] failed:', error.message);
  try {
    await mirror.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
