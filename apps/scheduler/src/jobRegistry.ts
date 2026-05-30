import { Queue } from 'bullmq';
import { db } from '@monitor/db';
import type { HealthCheckJobData, MonitoredApi } from '@monitor/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegistryEntry {
  apiId:       string;
  intervalSec: number;
  region:      string;
  userId:      string;
}

// ─── Job Registry ────────────────────────────────────────────────────────────

/**
 * JobRegistry is the source-of-truth adapter between the DB config
 * and BullMQ's repeatable job store.
 *
 * Responsibilities:
 *  - loadFromDB()   : read all active APIs from DB
 *  - reconcile()    : diff DB state vs live BullMQ jobs and apply changes
 *  - add()          : register a new repeatable job
 *  - remove()       : cancel and remove a repeatable job
 *  - buildJobKey()  : deterministic key for a given API
 */
export class JobRegistry {
  // In-memory snapshot of what we last synced — used to detect changes
  private snapshot = new Map<string, RegistryEntry>();

  constructor(private readonly queue: Queue<HealthCheckJobData>) {}

  // ── Deterministic BullMQ job name (used as the repeatable job key) ─────────
  static buildJobKey(apiId: string): string {
    return `check:${apiId}`;
  }

  // ── Load active APIs from the database ─────────────────────────────────────
  async loadFromDB(): Promise<RegistryEntry[]> {
    const { rows } = await db.query<Pick<MonitoredApi, 'id' | 'interval_sec' | 'region' | 'user_id'>>(
      `SELECT id, interval_sec, region, user_id
       FROM monitored_apis
       WHERE is_active = TRUE`
    );
    return rows.map((r) => ({
      apiId:       r.id,
      intervalSec: r.interval_sec,
      region:      r.region,
      userId:      r.user_id,
    }));
  }

  // ── Get all live repeatable jobs currently registered in BullMQ ────────────
  async getLiveJobKeys(): Promise<Set<string>> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    return new Set(repeatableJobs.map((j) => j.name));
  }

  // ── Upsert a single repeatable job ─────────────────────────────────────────
  async add(entry: RegistryEntry): Promise<void> {
    const { apiId, intervalSec, region, userId } = entry;
    const jobName = JobRegistry.buildJobKey(apiId);

    // BullMQ upsertJobScheduler is idempotent:
    // same name + same interval = no-op; changed interval = reschedule
    await this.queue.upsertJobScheduler(
      jobName,
      { every: intervalSec * 1000 },
      {
        name: 'health-check',
        data: { apiId, region, userId } satisfies HealthCheckJobData,
        opts: {
          priority:         1,
          removeOnComplete: { count: 100, age: 3600 },
          removeOnFail:     { count: 500, age: 86400 },
          attempts:         1,
        },
      }
    );

    this.snapshot.set(apiId, entry);
  }

  // ── Remove a repeatable job ─────────────────────────────────────────────────
  async remove(apiId: string): Promise<void> {
    const jobName = JobRegistry.buildJobKey(apiId);
    await this.queue.removeRepeatable(jobName, { every: 0 });
    this.snapshot.delete(apiId);
  }

  // ── Full reconciliation: DB is the source of truth ─────────────────────────
  //
  // Three operations:
  //   ADD   — in DB but not in BullMQ (new API or worker restart)
  //   UPDATE— in both but interval/region changed
  //   REMOVE— in BullMQ but not in DB (deleted or paused API)
  //
  async reconcile(): Promise<{ added: number; updated: number; removed: number }> {
    const [dbEntries, liveKeys] = await Promise.all([
      this.loadFromDB(),
      this.getLiveJobKeys(),
    ]);

    const dbMap = new Map<string, RegistryEntry>(
      dbEntries.map((e) => [e.apiId, e])
    );

    let added   = 0;
    let updated = 0;
    let removed = 0;

    // ADD or UPDATE
    for (const entry of dbEntries) {
      const jobKey = JobRegistry.buildJobKey(entry.apiId);
      const prev   = this.snapshot.get(entry.apiId);

      if (!liveKeys.has(jobKey)) {
        // Not in BullMQ at all — add it
        await this.add(entry);
        added++;
      } else if (
        prev &&
        (prev.intervalSec !== entry.intervalSec || prev.region !== entry.region)
      ) {
        // Config changed — upsertJobScheduler handles the reschedule
        await this.add(entry);
        updated++;
      } else if (!prev) {
        // In BullMQ from a previous process, but not in our snapshot — re-register
        this.snapshot.set(entry.apiId, entry);
      }
    }

    // REMOVE — in BullMQ but no longer in DB (or now inactive)
    for (const liveKey of liveKeys) {
      // liveKey format: "check:<uuid>"
      const apiId = liveKey.replace('check:', '');
      if (!dbMap.has(apiId)) {
        await this.remove(apiId).catch((err) =>
          console.warn(`[registry] Failed to remove job ${liveKey}:`, err.message)
        );
        removed++;
      }
    }

    return { added, updated, removed };
  }
}
