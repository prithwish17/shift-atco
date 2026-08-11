/**
 * Edge function invocation with a same-origin proxy fallback.
 *
 * Direct supabase.functions.invoke() calls fail in environments where the
 * Supabase functions host is blocked; the /api/functions/* Vercel route exists
 * as a same-origin path through. This helper tries the direct call, refreshes an
 * expired session once on 401, and falls back to the proxy.
 *
 * This mirrors the local copies inside RatingsManagement.tsx and
 * AdminDashboard.tsx. New callers should import this one.
 */

import { getFunctionsProxyBaseUrl } from '@/lib/appConfig';
import { supabase } from '@/integrations/supabase/client';

async function getCurrentOrRefreshedSession(forceRefresh = false) {
    if (forceRefresh) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) {
            return data.session;
        }
    }

    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export function isUnauthorizedError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('unauthorized') || normalized.includes('401');
}

async function invokeEdgeFunctionViaProxy<T>(
    functionName: string,
    body: Record<string, unknown>,
    forceRefresh = false,
): Promise<T> {
    const session = await getCurrentOrRefreshedSession(forceRefresh);

    if (!session) {
        throw new Error('Unauthorized');
    }

    const base = getFunctionsProxyBaseUrl();
    const response = await fetch(`${base}/api/functions/${functionName}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (response.ok) {
        return (await response.json()) as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let message = `Edge function ${functionName} failed: HTTP ${response.status}`;

    if (contentType.includes('application/json')) {
        const errBody = await response.json().catch(() => ({}));
        message = errBody.error || errBody.message || message;
    }

    if (response.status === 401 && !forceRefresh) {
        return invokeEdgeFunctionViaProxy<T>(functionName, body, true);
    }

    throw new Error(message);
}

export async function invokeEdgeFunction<T>(
    functionName: string,
    body: Record<string, unknown> = {},
): Promise<T> {
    try {
        const { data, error } = await supabase.functions.invoke(functionName, { body });
        if (!error) {
            return data as T;
        }
        throw error;
    } catch (error) {
        if (isUnauthorizedError(error)) {
            await getCurrentOrRefreshedSession(true);

            try {
                const { data, error: retryError } = await supabase.functions.invoke(functionName, { body });
                if (!retryError) {
                    return data as T;
                }
                throw retryError;
            } catch (retryError) {
                return invokeEdgeFunctionViaProxy<T>(functionName, body, isUnauthorizedError(retryError));
            }
        }

        return invokeEdgeFunctionViaProxy<T>(functionName, body, false);
    }
}
