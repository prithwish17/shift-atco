import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from '../lib/apiAuth.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schedule-archive
//
// Reads archived (>2-month-old) employee_schedules rows back from the audit-log
// Google Sheet on demand. The data was shipped there by the archive-schedules
// edge function; this route just proxies the sheet's doGet and returns JSON.
//
// Query params (all optional, but give at least a range):
//   month=YYYY-MM           convenience: expands to from=YYYY-MM-01 .. month end
//   from=YYYY-MM-DD         range start (inclusive)
//   to=YYYY-MM-DD           range end (inclusive)
//   employee=CODE           filter to a single employee_code
//
// Auth: any authenticated user (mirrors the other /api read routes).
// ─────────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return { from, to: end.toISOString().slice(0, 10) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  // Resolve date range
  let from = typeof req.query.from === 'string' ? req.query.from : '';
  let to = typeof req.query.to === 'string' ? req.query.to : '';
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  const employee = typeof req.query.employee === 'string' ? req.query.employee : '';

  if (month) {
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    ({ from, to } = monthBounds(month));
  }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  }
  if (!from && !to && !employee) {
    return res.status(400).json({ error: 'Provide month, a from/to range, or an employee code' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'supervisor_audit_log_webapp_url')
      .maybeSingle();

    const webappUrl = (setting as any)?.value || '';
    if (!webappUrl) {
      return res.status(400).json({ error: 'Audit-log webapp URL not configured' });
    }

    const url = new URL(webappUrl);
    url.searchParams.set('type', 'schedule_archive');
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (employee) url.searchParams.set('employee', employee);

    const resp = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      return res.status(502).json({ error: `Audit-log webapp returned ${resp.status}` });
    }

    const json: any = await resp.json().catch(() => null);
    if (!json || json.status !== 'success' || !Array.isArray(json.data)) {
      return res.status(502).json({ error: 'Unexpected response from audit-log webapp' });
    }

    setCorsHeaders(req, res);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json({ rows: json.data, from, to, employee: employee || null, count: json.data.length });
  } catch (error: any) {
    console.error('[schedule-archive] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
