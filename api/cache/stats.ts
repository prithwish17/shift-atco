import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../../lib/redis.js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, 'GET, OPTIONS')) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Get hits and misses for today and yesterday
    const [todayHits, todayMisses, yesterdayHits, yesterdayMisses] = await Promise.all([
      redis.hgetall(`stats:hits:${today}`),
      redis.hgetall(`stats:misses:${today}`),
      redis.hgetall(`stats:hits:${yesterday}`),
      redis.hgetall(`stats:misses:${yesterday}`),
    ]);

    // hgetall() is typed Record<string, unknown> and Upstash deserialises
    // numeric-looking values, so a counter arrives as a number about as often as
    // a string. Number() handles both, and the guard keeps one unparseable
    // field from turning the whole total into NaN.
    const calculateTotal = (obj: Record<string, unknown> | null) =>
      Object.values(obj ?? {}).reduce<number>((sum, val) => {
        const parsed = Number(val);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);

    const todayHitsTotal = calculateTotal(todayHits);
    const todayMissesTotal = calculateTotal(todayMisses);
    const todayTotal = todayHitsTotal + todayMissesTotal;
    const todayHitRatio = todayTotal > 0 ? (todayHitsTotal / todayTotal) * 100 : 0;

    const yesterdayHitsTotal = calculateTotal(yesterdayHits);
    const yesterdayMissesTotal = calculateTotal(yesterdayMisses);
    const yesterdayTotal = yesterdayHitsTotal + yesterdayMissesTotal;
    const yesterdayHitRatio = yesterdayTotal > 0 ? (yesterdayHitsTotal / yesterdayTotal) * 100 : 0;

    const stats = {
      today: {
        date: today,
        hits: todayHitsTotal,
        misses: todayMissesTotal,
        total: todayTotal,
        hitRatio: Math.round(todayHitRatio * 10) / 10,
        byKey: {
          hits: todayHits || {},
          misses: todayMisses || {},
        },
      },
      yesterday: {
        date: yesterday,
        hits: yesterdayHitsTotal,
        misses: yesterdayMissesTotal,
        total: yesterdayTotal,
        hitRatio: Math.round(yesterdayHitRatio * 10) / 10,
        byKey: {
          hits: yesterdayHits || {},
          misses: yesterdayMisses || {},
        },
      },
    };

    setCorsHeaders(req, res);
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json(stats);
  } catch (error: any) {
    console.error('[cache-stats] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
