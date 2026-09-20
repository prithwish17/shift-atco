/**
 * Per-user rate limits for the expensive night-allocation endpoints.
 *
 * Fixed window in Upstash Redis, which the app already runs for caching, so
 * this adds no service and no cost. It fails **open**: Redis being unreachable
 * must not stop the WSO publishing tonight's roster, and every limited endpoint
 * is authenticated and cheap to serve a few extra times.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(
  scope: string,
  userId: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `ratelimit:night-alloc:${scope}:${userId}:${bucket}`;

  try {
    // Imported lazily: the Upstash client throws at construction when the REST
    // env vars are unset, and a missing rate limiter must not take down the
    // endpoints that do the actual work.
    const { redis } = await import("../redis.js");
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
    };
  } catch (error) {
    console.error("[night-allocation] rate limit unavailable, allowing request", error);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}
