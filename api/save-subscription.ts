import type { VercelRequest, VercelResponse } from "@vercel/node";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ALLOWED_ORIGINS = [
  "https://shift-atco.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:3000",
];

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";

  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    setCorsHeaders(req, res);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, x-client-info");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars" });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const { endpoint, keys, user_id } = req.body || {};

  if (!endpoint || !keys?.p256dh || !keys?.auth || !user_id) {
    return res.status(400).json({ error: "Missing required subscription fields" });
  }

  const targetUrl = new URL("/rest/v1/push_subscriptions?on_conflict=user_id,endpoint", SUPABASE_URL);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: authHeader,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
      }),
    });

    setCorsHeaders(req, res);

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).send(body);
    }

    return res.status(204).end();
  } catch (error: any) {
    console.error("[Save Subscription Error]", error);
    return res.status(502).json({
      error: "Failed to save subscription",
      message: error.message,
    });
  }
}