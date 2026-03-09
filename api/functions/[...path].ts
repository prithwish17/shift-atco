import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

/**
 * Proxy for Supabase Edge Functions.
 * Forwards /api/functions/* → SUPABASE_URL/functions/v1/*
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars' });
    }

    // Extract the function name + sub-path
    const pathSegments = req.query.path;
    const subPath = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments || '');

    // Build the target URL: SUPABASE_URL/functions/v1/<subPath>
    const url = new URL(`/functions/v1/${subPath}`, SUPABASE_URL);

    // Forward query parameters (excluding the catch-all "path" param)
    const queryEntries = Object.entries(req.query).filter(([key]) => key !== 'path');
    for (const [key, value] of queryEntries) {
        if (Array.isArray(value)) {
            value.forEach(v => url.searchParams.append(key, String(v)));
        } else if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
        }
    }

    // Build headers
    const headers: Record<string, string> = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': req.headers['content-type'] || 'application/json',
    };

    if (req.headers['authorization']) {
        headers['Authorization'] = req.headers['authorization'] as string;
    }

    try {
        const fetchOptions: RequestInit = {
            method: req.method || 'GET',
            headers,
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(url.toString(), fetchOptions);

        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        const body = await response.text();
        return res.status(response.status).send(body);
    } catch (error: any) {
        console.error('[Functions Proxy Error]', error);
        return res.status(502).json({
            error: 'Proxy request failed',
            message: error.message,
        });
    }
}
