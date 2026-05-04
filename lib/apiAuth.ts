import type { VercelRequest, VercelResponse } from "@vercel/node";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_PUBLIC_SUPABASE_ANON_KEY ?? "";

const ALLOWED_ORIGINS = [
    "https://shift-atco.vercel.app",
    "https://www.atcora.in",
    "https://atcora.in",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost:3000",
];

export function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
    const origin = req.headers.origin || "";
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Vary", "Origin");
}

export function handleCorsPreflight(
    req: VercelRequest,
    res: VercelResponse,
    methods = "POST, OPTIONS",
): boolean {
    if (req.method !== "OPTIONS") return false;
    setCorsHeaders(req, res);
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, apikey, x-client-info",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return true;
}

export interface AuthenticatedUser {
    id: string;
    email?: string;
    accessToken: string;
}

/**
 * Validate a Supabase JWT supplied by the client and return the auth context.
 * Mirrors the security model used by api/save-subscription.ts:
 *  - Require an Authorization: Bearer <jwt> header.
 *  - Validate against Supabase auth/v1/user.
 */
export async function authenticateRequest(
    req: VercelRequest,
    res: VercelResponse,
): Promise<AuthenticatedUser | null> {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        res.status(500).json({ error: "Server misconfigured: missing Supabase env vars" });
        return null;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or malformed Authorization header" });
        return null;
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) {
        res.status(401).json({ error: "Empty bearer token" });
        return null;
    }

    try {
        const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: SUPABASE_ANON_KEY,
            },
        });

        if (!userResponse.ok) {
            res.status(401).json({ error: "Invalid auth token" });
            return null;
        }

        const user = (await userResponse.json()) as { id: string; email?: string };
        if (!user?.id) {
            res.status(401).json({ error: "Invalid auth response" });
            return null;
        }

        return { id: user.id, email: user.email, accessToken };
    } catch (err) {
        console.error("[apiAuth] auth failure", err);
        res.status(502).json({ error: "Auth service unreachable" });
        return null;
    }
}

/**
 * Helper to make a Supabase REST call on behalf of the authenticated user
 * (the user's JWT enforces RLS server-side).
 */
export async function supabaseUserFetch(
    user: AuthenticatedUser,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${user.accessToken}`);
    headers.set("apikey", SUPABASE_ANON_KEY);
    if (!headers.has("Content-Type") && init.body) {
        headers.set("Content-Type", "application/json");
    }
    return fetch(`${SUPABASE_URL}${path}`, { ...init, headers });
}

export const supabaseEnv = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
};
