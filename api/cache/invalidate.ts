import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '../../lib/redis.js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    const { keys } = req.body;

    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys array is required' });
    }

    // Delete all specified keys
    await redis.del(...keys);

    setCorsHeaders(req, res);
    return res.status(200).json({ 
      ok: true, 
      invalidated: keys.length,
      keys,
    });
  } catch (error: any) {
    console.error('[cache-invalidate] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
