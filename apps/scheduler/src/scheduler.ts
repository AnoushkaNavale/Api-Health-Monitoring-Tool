import { getHealthCheckQueue } from '@monitor/queue';
import { getPool } from '@monitor/db';
import { JobRegistry } from './jobRegistry';
import type { PoolClient } from '@monitor/db';

// ─── Constants ───────────────────────────────────────────────────────────────

// Full reconciliation interval — catches any drift between DB and BullMQ.
// Even with LISTEN/NOTIFY this is the safety net.
const FULL_SYNC_INTERVAL_MS = 60_000; // every 60s

// Postgres channel name — the API service sends NOTIFY on this channel
// whenever a monitored_api row is inserted, updated, or deleted.
const PG_NOTIFY_CHANNEL = 'api_config_changed';

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class Scheduler {
  private registry:      JobRegistry;
  private syncTimer:     ReturnType<typeof setInterval> | null = null;
  private pgListener:    PoolClient | null = null;
  private isRunning      = false;

  constructor() {
    this.registry = new JobRegistry(getHealthCheckQueue());
  }

  // ── Startup ─────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[scheduler] Starting...');

    // 1. Full sync on startup — registers all active APIs with BullMQ
    await this.runFullSync();

    // 2. Periodic full sync (safety net for any drift)
    this.syncTimer = setInterval(() => {
      this.runFullSync().catch((err) =>
        console.error('[scheduler] Sync error:', err.message)
      );
    }, FULL_SYNC_INTERVAL_MS);

    // 3. Postgres LISTEN/NOTIFY — react immediately to config changes
    await this.startPgListener();

    console.log('[scheduler] Running.');
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.pgListener) {
      await this.pgListener.query(`UNLISTEN ${PG_NOTIFY_CHANNEL}`);
      this.pgListener.release();
      this.pgListener = null;
    }

    console.log('[scheduler] Stopped.');
  }

  // ── Full reconciliation ──────────────────────────────────────────────────────

  private async runFullSync(): Promise<void> {
    const start = Date.now();
    try {
      const { added, updated, removed } = await this.registry.reconcile();
      const elapsed = Date.now() - start;
      if (added || updated || removed) {
        console.log(
          `[scheduler] Sync complete in ${elapsed}ms — +${added} added, ~${updated} updated, -${removed} removed`
        );
      }
    } catch (err: any) {
      console.error('[scheduler] Full sync failed:', err.message);
    }
  }

  // ── Postgres LISTEN/NOTIFY listener ─────────────────────────────────────────
  //
  // The API service fires:
  //   NOTIFY api_config_changed, '{"action":"upsert","apiId":"<uuid>"}';
  //   NOTIFY api_config_changed, '{"action":"delete","apiId":"<uuid>"}';
  //
  // This lets us react in < 1 second instead of waiting for the next full sync.

  private async startPgListener(): Promise<void> {
    const pool = getPool();
    this.pgListener = await pool.connect();

    // Keep the connection alive
    const keepAlive = setInterval(() => {
      this.pgListener?.query('SELECT 1').catch(() => {});
    }, 10_000);

    this.pgListener.on('notification', async (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== PG_NOTIFY_CHANNEL || !msg.payload) return;

      try {
        const { action, apiId } = JSON.parse(msg.payload) as {
          action: 'upsert' | 'delete';
          apiId:  string;
        };

        console.log(`[scheduler] NOTIFY received: action=${action} apiId=${apiId}`);

        if (action === 'delete') {
          await this.registry.remove(apiId);
        } else {
          // 'upsert' — reload this specific API from DB and re-register
          const { rows } = await getPool().query(
            `SELECT id, interval_sec, region, user_id, is_active
             FROM monitored_apis WHERE id = $1`,
            [apiId]
          );
          if (!rows.length || !rows[0].is_active) {
            // Deleted between notification and query, or just deactivated
            await this.registry.remove(apiId).catch(() => {});
          } else {
            await this.registry.add({
              apiId:       rows[0].id,
              intervalSec: rows[0].interval_sec,
              region:      rows[0].region,
              userId:      rows[0].user_id,
            });
          }
        }
      } catch (err: any) {
        console.error('[scheduler] Error processing notification:', err.message);
      }
    });

    this.pgListener.on('error', (err: Error) => {
      console.error('[scheduler] Postgres listener error:', err.message);
      clearInterval(keepAlive);
      // Reconnect after a delay — runFullSync will catch up any missed events
      setTimeout(() => {
        this.startPgListener().catch(console.error);
      }, 5000);
    });

    await this.pgListener.query(`LISTEN ${PG_NOTIFY_CHANNEL}`);
    console.log(`[scheduler] Listening on Postgres channel: ${PG_NOTIFY_CHANNEL}`);
  }
}
