import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function run() {
  try {
    const res = await redis.setex('test-setex', 10, 'hello');
    console.log("setex response:", res);
    const val = await redis.get('test-setex');
    console.log("get response:", val);
  } catch (err) {
    console.error("setex error:", err);
  }
}
run();
