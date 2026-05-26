import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function run() {
  const data = { hello: "world" };
  await redis.setex('test-json', 10, JSON.stringify(data));
  const val1 = await redis.get('test-json');
  console.log("val1 type:", typeof val1, "value:", val1);
  
  await redis.setex('test-obj', 10, data);
  const val2 = await redis.get('test-obj');
  console.log("val2 type:", typeof val2, "value:", val2);
}
run();
