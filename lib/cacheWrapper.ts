import { redis, recordCacheHit, recordCacheMiss } from './redis.js';

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
  bypassCache?: boolean;
}

/**
 * Generic cache wrapper for API routes
 * Usage:
 *   const data = await withCache(
 *     'cache:key',
 *     async () => expensiveQuery(),
 *     { ttl: 300, tags: ['schedule'] }
 *   );
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl, tags = [], bypassCache = false } = options;

  // Bypass cache if requested (useful for force refresh)
  if (bypassCache) {
    const data = await fetcher();
    if (ttl) {
      await redis.setex(key, ttl, JSON.stringify(data));
      // Track key for invalidation
      if (tags.length > 0) {
        for (const tag of tags) {
          await redis.sadd(`keys:${tag}`, key);
        }
      }
    }
    return data;
  }

  // Try cache first
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      await recordCacheHit(key);
      // redis.get() is typed `unknown`; the value is whatever this key's caller
      // stored, which withCache cannot verify — the cast states that explicitly.
      return (typeof cached === 'string' ? JSON.parse(cached) : cached) as T;
    }
  } catch (err) {
    console.warn(`[cache] Redis read error for ${key}:`, err);
  }

  // Cache miss - fetch and store
  await recordCacheMiss(key);
  const data = await fetcher();

  try {
    if (ttl) {
      await redis.setex(key, ttl, JSON.stringify(data));
      // Track key for invalidation
      if (tags.length > 0) {
        for (const tag of tags) {
          await redis.sadd(`keys:${tag}`, key);
        }
      }
    }
  } catch (err) {
    console.warn(`[cache] Redis write error for ${key}:`, err);
  }

  return data;
}
