import { runMigrations } from '@monitor/db';
import { Scheduler } from './scheduler';

async function main() {
  // ── Validate required env vars ────────────────────────────────────────────

  const required = ['DATABASE_URL', 'REDIS_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`[scheduler] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  // ── Run DB migrations (idempotent) ────────────────────────────────────────
  // The scheduler runs migrations too so it can boot independently of the API.

  await runMigrations();

  // ── Start scheduler ───────────────────────────────────────────────────────

  const scheduler = new Scheduler();
  await scheduler.start();

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`[scheduler] Received ${signal}, shutting down...`);
    await scheduler.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Keep process alive (the scheduler loop runs on setInterval + pg listener)
  process.stdin.resume();
}

main().catch((err) => {
  console.error('[scheduler] Fatal error:', err);
  process.exit(1);
});
