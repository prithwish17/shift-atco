import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { withCache } from '../lib/cacheWrapper.js';
import { CacheKeys, CacheTTL } from '../lib/redis.js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, 'GET, OPTIONS')) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authentication
  const user = await authenticateRequest(req, res);
  if (!user) return;

  const { month } = req.query;
  if (!month || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format (expected yyyy-MM)' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const data = await withCache(
      CacheKeys.workingHours(month),
      async () => {
        // Try cache table first
        const { data: cacheData, error: cacheError } = await supabase
          .from('working_hours_cache')
          .select('*')
          .eq('month', month);

        if (!cacheError && cacheData && cacheData.length > 0) {
          return {
            rows: cacheData,
            computedAt: cacheData[0]?.computed_at || null,
            source: 'cache_table',
          };
        }

        // Fall back to RPC
        const { data: rpcData, error: rpcError } = await supabase
          .rpc('get_working_hours_summary', { p_month: month });

        if (rpcError) throw rpcError;

        return {
          rows: rpcData || [],
          computedAt: null,
          source: 'rpc',
        };
      },
      { ttl: CacheTTL.workingHours, tags: ['working-hours'] }
    );

    res.setHeader('Cache-Control', 'private, max-age=60');
    setCorsHeaders(req, res);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[working-hours] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
