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
 * Proxy for Supabase Edge Functions.
 * Forwards /api/functions/* → SUPABASE_URL/functions/v1/*
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        setCorsHeaders(req, res);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, x-client-info');
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
    const targetUrl = new URL(`/functions/v1/${subPath}`, SUPABASE_URL);

    // Forward the raw query string to avoid double-encoding
    const incomingUrl = new URL(req.url!, `http://${req.headers.host}`);
    incomingUrl.searchParams.delete('path');
    const rawQs = incomingUrl.search;
    if (rawQs) {
        targetUrl.search = rawQs;
    }

    // Build headers
    const headers: Record<string, string> = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': req.headers['content-type'] || 'application/json',
    };

    if (req.headers['authorization']) {
        headers['Authorization'] = req.headers['authorization'] as string;
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

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);

        setCorsHeaders(req, res);

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

