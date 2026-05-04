import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

export interface AuthenticatedUserRecord {
  id: string;
  email: string;
  full_name: string;
  employee_id: string;
  current_shift: string | null;
  role: string | null;
  approved: boolean;
  has_profile: boolean;
  email_confirmed: boolean;
  phone_confirmed: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  provider: string;
  providers: string[];
  registration_source: string | null;
}

export interface AuthenticatedUsersResponse {
  users: AuthenticatedUserRecord[];
  total: number;
}

async function getCurrentOrRefreshedSession(forceRefresh = false) {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      return data.session;
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

async function invokeAuthenticatedUsersDirect() {
  const { data, error } = await supabase.functions.invoke("authenticated-users", { body: {} });

  if (error) {
    throw error;
  }

  return data as AuthenticatedUsersResponse;
}

async function invokeAuthenticatedUsersViaProxy(forceRefresh = false) {
  const session = await getCurrentOrRefreshedSession(forceRefresh);

  if (!session) {
    throw new Error("Unauthorized");
  }

  const base = getFunctionsProxyBaseUrl();
  const response = await fetch(`${base}/api/functions/authenticated-users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Authenticated users request failed: HTTP ${response.status}`);
    }

    throw new Error(`Authenticated users request failed: HTTP ${response.status}`);
  }

  return (await response.json()) as AuthenticatedUsersResponse;
}

function isUnauthorizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return normalized.includes("unauthorized") || normalized.includes("401");
}

export async function fetchAuthenticatedUsers() {
  try {
    return await invokeAuthenticatedUsersDirect();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return invokeAuthenticatedUsersViaProxy(true);
    }

    return invokeAuthenticatedUsersViaProxy(false);
  }
}