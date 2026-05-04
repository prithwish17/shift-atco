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

  const user = await authenticateRequest(req, res);
  if (!user) return;

  const { month, team, status = 'Approved' } = req.query;
  if (!month || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format (expected yyyy-MM)' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const data = await withCache(
      CacheKeys.leaveRoster(month, team as string),
      async () => {
        // Fetch leave requests for the month
        const startDate = `${month}-01`;
        const endDate = `${month}-31`;

        let query = supabase
          .from('leave_requests')
          .select('*')
          .eq('status', status)
          .gte('start_date', startDate)
          .lte('end_date', endDate)
          .order('start_date')
          .limit(500);

        const { data: leaves, error } = await query;
        if (error) throw error;

        return { 
          leaves: leaves || [], 
          fetchedAt: new Date().toISOString(),
          month,
          status,
        };
      },
      { ttl: CacheTTL.leaveRoster, tags: ['leave-roster', month] }
    );

    res.setHeader('Cache-Control', 'private, max-age=120');
    setCorsHeaders(req, res);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[leave-roster] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
