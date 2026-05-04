import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, 'GET, OPTIONS')) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Get slow queries from api_call_logs (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    
    const { data: slowQueries, error: slowError } = await supabase
      .from('api_call_logs')
      .select('endpoint, duration_ms, created_at, message')
      .gte('created_at', oneDayAgo)
      .gte('duration_ms', 2000) // Queries over 2s
      .order('duration_ms', { ascending: false })
      .limit(20);

    if (slowError) throw slowError;

    // Get average response times per endpoint
    const { data: avgTimes, error: avgError } = await supabase
      .from('api_call_logs')
      .select('endpoint, duration_ms')
      .gte('created_at', oneDayAgo);

    if (avgError) throw avgError;

    // Calculate averages by endpoint
    const endpointStats: Record<string, { count: number; total: number; avg: number }> = {};
    
    (avgTimes || []).forEach((log: any) => {
      if (!endpointStats[log.endpoint]) {
        endpointStats[log.endpoint] = { count: 0, total: 0, avg: 0 };
      }
      endpointStats[log.endpoint].count++;
      endpointStats[log.endpoint].total += log.duration_ms;
    });

    Object.keys(endpointStats).forEach(endpoint => {
      const stats = endpointStats[endpoint];
      stats.avg = Math.round(stats.total / stats.count);
    });

    const metrics = {
      slowQueries: slowQueries || [],
      endpointStats,
      summary: {
        totalCalls: avgTimes?.length || 0,
        slowQueriesCount: slowQueries?.length || 0,
        timeRange: '24 hours',
      },
    };

    setCorsHeaders(req, res);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(metrics);
  } catch (error: any) {
    console.error('[metrics] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
