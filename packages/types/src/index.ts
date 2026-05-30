export type ApiState = 'UP' | 'DEGRADED' | 'DOWN';
export type AlertType = 'failure' | 'latency_spike' | 'recovery';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  plan: 'free' | 'pro' | 'enterprise';
  created_at: Date;
}

export interface MonitoredApi {
  id: string;
  user_id: string;
  name: string;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  expected_status: number;
  timeout_ms: number;
  interval_sec: number;
  tags: string[];
  region: string;
  is_active: boolean;
  state: ApiState;
  consecutive_failures: number;
  created_at: Date;
  updated_at: Date;
}

export interface HealthCheck {
  id: bigint;
  api_id: string;
  checked_at: Date;
  status_code: number | null;
  response_ms: number | null;
  is_success: boolean;
  error_message: string | null;
  region: string;
}

export interface AlertConfig {
  id: string;
  api_id: string;
  failure_threshold: number;
  latency_threshold_ms: number;
  cooldown_minutes: number;
  notify_email: string[];
  notify_webhooks: WebhookConfig[];
}

export interface WebhookConfig {
  url: string;
  type: 'slack' | 'discord' | 'generic';
}

export interface AlertHistory {
  id: bigint;
  api_id: string;
  alert_type: AlertType;
  triggered_at: Date;
  resolved_at: Date | null;
  details: Record<string, unknown>;
}

export interface StatusPage {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  api_ids: string[];
  is_public: boolean;
}

export interface HealthCheckJobData {
  apiId: string;
  region: string;
  userId: string;
}

export interface CreateApiRequest {
  name: string;
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  expected_status?: number;
  timeout_ms?: number;
  interval_sec?: number;
  tags?: string[];
  region?: string;
}

export interface UpdateApiRequest extends Partial<CreateApiRequest> {
  is_active?: boolean;
}

export interface CreateAlertConfigRequest {
  api_id: string;
  failure_threshold?: number;
  latency_threshold_ms?: number;
  cooldown_minutes?: number;
  notify_email?: string[];
  notify_webhooks?: WebhookConfig[];
}

export interface ApiMetrics {
  total_checks: number;
  successful_checks: number;
  uptime_pct: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  error_rate_pct: number;
}

export interface HourlyMetricBucket {
  bucket: Date;
  avg_latency_ms: number;
  p95_latency_ms: number;
  uptime_pct: number;
}

export interface CheckResult {
  statusCode: number | null;
  responseMs: number | null;
  isSuccess: boolean;
  errorMessage?: string;
}

export interface ApiStateCache {
  state: ApiState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string;
}
