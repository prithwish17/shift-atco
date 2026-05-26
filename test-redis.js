import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function run() {
  try {
    await redis.set('test-key', 'works', { ex: 10 });
    const val = await redis.get('test-key');
    console.log("Redis connection test:", val);
    
    // Also check the stats
    const keys = await redis.keys('*');
    console.log("Total keys in Redis:", keys.length);
  } catch (err) {
    console.error("Redis error:", err);
  }
}
run();
