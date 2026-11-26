/**
 * Retry schedule of website webhooks (pure). Attempt n (1-based) that failed
 * is retried after BACKOFF_MS[n-1]; after MAX_ATTEMPTS the delivery is marked
 * failed. The daily cron and every new change both drain due deliveries.
 */
export const WEBHOOK_RESOURCES = ["club", "programs", "camps", "events", "results", "teams", "coaches", "training", "shop", "campaigns", "news"] as const;
export type WebhookResource = (typeof WEBHOOK_RESOURCES)[number];

export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

export function nextAttemptAt(attemptsSoFar: number, now: Date): Date | null {
  if (attemptsSoFar >= MAX_ATTEMPTS) return null;
  const delay = BACKOFF_MS[Math.min(attemptsSoFar - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[0];
  return new Date(now.getTime() + delay);
}

/** Treat 2xx as delivered; 4xx other than 408/409/425/429 will not get better by retrying. */
export function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
