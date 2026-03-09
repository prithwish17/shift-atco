import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ALLOWED_ORIGINS = [
    'https://shift-atco.vercel.app',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
];

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
    const origin = req.headers.origin || '';
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
}

/**
 * Generic catch-all proxy for all Supabase REST, Auth, and Storage requests.
 * Forwards /api/supabase/* → SUPABASE_URL/*
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, x-client-info, prefer');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars' });
    }

    // Extract the supabase sub-path from the catch-all param
    const pathSegments = req.query.path;
    const subPath = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments || '');

    // Build the target URL
    const targetUrl = new URL(`/${subPath}`, SUPABASE_URL);

    // Forward the raw query string from the incoming request to avoid
    // double-encoding PostgREST operators like commas, colons, and parentheses
    // (e.g. select=*,user:user_id(full_name) must NOT be re-encoded).
    const incomingUrl = new URL(req.url!, `http://${req.headers.host}`);
    incomingUrl.searchParams.delete('path');
    const rawQs = incomingUrl.search;
    if (rawQs) {
        targetUrl.search = rawQs;
    }

    // Build headers to forward
    const headers: Record<string, string> = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': req.headers['content-type'] || 'application/json',
    };

    // Forward Authorization header (user's JWT)
    if (req.headers['authorization']) {
        headers['Authorization'] = req.headers['authorization'] as string;
    }

    // Forward Prefer header (for PostgREST options like count, return=representation)
    if (req.headers['prefer']) {
        headers['Prefer'] = req.headers['prefer'] as string;
    }

    // Forward x-client-info if present
    if (req.headers['x-client-info']) {
        headers['x-client-info'] = req.headers['x-client-info'] as string;
    }

    try {
        const fetchOptions: RequestInit = {
            method: req.method || 'GET',
            headers,
        };

        // Forward body for non-GET requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);

        // Set CORS headers on response
        setCorsHeaders(req, res);

        // Forward relevant response headers
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            res.setHeader('Content-Range', contentRange);
        }

        const preferenceApplied = response.headers.get('preference-applied');
        if (preferenceApplied) {
            res.setHeader('Preference-Applied', preferenceApplied);
        }

        // Stream the response body
        const body = await response.text();
        return res.status(response.status).send(body);
    } catch (error: any) {
        console.error('[Supabase Proxy Error]', error);
        return res.status(502).json({
            error: 'Proxy request failed',
            message: error.message,
        });
    }
}
