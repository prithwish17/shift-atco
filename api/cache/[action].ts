import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../../lib/redis.js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../../lib/apiAuth.js';

/**
 * Cache stats and invalidation, behind one dynamic route.
 *
 * These were two files until the project hit the 12-serverless-function ceiling
 * on the Vercel plan. A dynamic segment still serves /api/cache/stats and
 * /api/cache/invalidate at their original URLs, so nothing that calls them had
 * to change — it just costs one function slot instead of two.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '');
  const methods = action === 'stats' ? 'GET, OPTIONS' : 'POST, OPTIONS';

  if (handleCorsPreflight(req, res, methods)) return;

  if (action === 'stats') return stats(req, res);
  if (action === 'invalidate') return invalidate(req, res);

  setCorsHeaders(req, res);
  return res.status(404).json({ error: `Unknown cache action '${action}'` });
}

async function stats(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [todayHits, todayMisses, yesterdayHits, yesterdayMisses] = await Promise.all([
      redis.hgetall(`stats:hits:${today}`),
      redis.hgetall(`stats:misses:${today}`),
      redis.hgetall(`stats:hits:${yesterday}`),
      redis.hgetall(`stats:misses:${yesterday}`),
    ]);

    // hgetall() is typed Record<string, unknown> and Upstash deserialises
    // numeric-looking values, so a counter arrives as a number about as often as
    // a string. Number() handles both, and the guard keeps one unparseable field
    // from turning the whole total into NaN.
    const calculateTotal = (obj: Record<string, unknown> | null) =>
      Object.values(obj ?? {}).reduce<number>((sum, val) => {
        const parsed = Number(val);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);

    const day = (date: string, hits: Record<string, unknown> | null, misses: Record<string, unknown> | null) => {
      const hitsTotal = calculateTotal(hits);
      const missesTotal = calculateTotal(misses);
      const total = hitsTotal + missesTotal;
      return {
        date,
        hits: hitsTotal,
        misses: missesTotal,
        total,
        hitRatio: total > 0 ? Math.round((hitsTotal / total) * 1000) / 10 : 0,
        byKey: { hits: hits || {}, misses: misses || {} },
      };
    };

    setCorsHeaders(req, res);
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      today: day(today, todayHits, todayMisses),
      yesterday: day(yesterday, yesterdayHits, yesterdayMisses),
    });
  } catch (error) {
    console.error('[cache-stats] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function invalidate(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    const { keys } = req.body ?? {};

    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys array is required' });
    }

    await redis.del(...keys);

    setCorsHeaders(req, res);
    return res.status(200).json({
      ok: true,
      invalidated: keys.length,
      keys,
    });
  } catch (error) {
    console.error('[cache-invalidate] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
