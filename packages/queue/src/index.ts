import { Queue, type ConnectionOptions } from 'bullmq';
import type { HealthCheckJobData } from '@monitor/types';

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  password: process.env.REDIS_PASSWORD ?? undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export const QUEUE_NAMES = {
  HEALTH_CHECKS: 'api-health-checks',
  ALERTS: 'alert-dispatch',
} as const;

let healthCheckQueue: Queue<HealthCheckJobData> | null = null;

export function getHealthCheckQueue(): Queue<HealthCheckJobData> {
  if (!healthCheckQueue) {
    healthCheckQueue = new Queue<HealthCheckJobData>(QUEUE_NAMES.HEALTH_CHECKS, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 3600 },
        removeOnFail: { count: 500, age: 86400 },
        attempts: 1,
      },
    });
  }
  return healthCheckQueue;
}
