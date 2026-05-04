import { Redis } from '@upstash/redis';

// Upstash Redis client (REST-based, works in serverless)
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Cache version - bump when data structure changes to invalidate old cache
export const CACHE_VERSION = 'v2';

// Key namespacing
export const CacheKeys = {
  // Working hours (versioned for schema changes)
  workingHours: (month: string) => `wh:${CACHE_VERSION}:${month}`,
  workingHoursSummary: (month: string) => `wh:summary:${CACHE_VERSION}:${month}`,
  
  // Availability
  availability: (month: string) => `avail:${month}`,
  
  // Leave roster
  leaveRoster: (month: string, team?: string) => 
    team ? `leave:${month}:${team}` : `leave:${month}`,
  
  // Schedule
  scheduleMonth: (month: string, empCode?: string) => 
    empCode ? `sched:${month}:${empCode}` : `sched:${month}`,
  
  // Roster
  roster: (team: string, shift: string, date: string) => 
    `roster:${team}:${shift}:${date}`,
  
  // Daily snapshot
  dailySnapshot: (date: string) => `daily:${date}`,
} as const;

// TTL configuration (in seconds)
export const CacheTTL = {
  workingHours: 20 * 60,        // 20 minutes
  availability: 15 * 60,         // 15 minutes
  leaveRoster: 10 * 60,          // 10 minutes
  schedule: 5 * 60,              // 5 minutes
  roster: 30 * 60,               // 30 minutes
  dailySnapshot: 60 * 60,        // 1 hour
} as const;

// Cache statistics tracking
export async function recordCacheHit(key: string) {
  try {
    const statKey = `stats:hits:${new Date().toISOString().slice(0, 10)}`;
    await redis.hincrby(statKey, key.split(':')[0], 1);
    await redis.expire(statKey, 7 * 24 * 60 * 60); // 7 days
  } catch (err) {
    console.warn('[redis] Failed to record cache hit:', err);
  }
}

export async function recordCacheMiss(key: string) {
  try {
    const statKey = `stats:misses:${new Date().toISOString().slice(0, 10)}`;
    await redis.hincrby(statKey, key.split(':')[0], 1);
    await redis.expire(statKey, 7 * 24 * 60 * 60);
  } catch (err) {
    console.warn('[redis] Failed to record cache miss:', err);
  }
}

// Batch invalidation helper
export async function invalidatePattern(pattern: string) {
  try {
    // Upstash doesn't support SCAN in REST API, so we track keys
    const trackKey = `keys:${pattern}`;
    const keys = await redis.smembers(trackKey);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      await redis.del(trackKey);
    }
  } catch (err) {
    console.warn('[redis] Failed to invalidate pattern:', err);
  }
}
