import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

export interface ImportEmployeePayload {
  employee_id: string;
  initials?: string | null;
  full_name: string;
  designation?: string | null;
  stream?: string | null;
  mobile?: string | null;
  email: string;
  gender?: string | null;
  alternate_email?: string | null;
  address?: string | null;
  current_shift: string;
}

export interface ImportEmployeesResult {
  created: string[];
  updated?: string[];
  skipped: { employee_id: string; reason: string }[];
  failed: { employee_id: string; error: string }[];
}

function isUnauthorizedMessage(message?: string | null) {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("unauthorized") || normalized.includes("401");
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

async function invokeImportEmployeesDirect(body: {
  employees: ImportEmployeePayload[];
  update_duplicates?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke("import-employees", {
    body,
  });

  if (error) {
    throw error;
  }

  return data as ImportEmployeesResult;
}

async function invokeImportEmployeesViaProxy(
  body: {
    employees: ImportEmployeePayload[];
    update_duplicates?: boolean;
  },
  forceRefresh = false,
) {
  const session = await getCurrentOrRefreshedSession(forceRefresh);

  if (!session) {
    throw new Error("Unauthorized");
  }

  const base = getFunctionsProxyBaseUrl();
  const response = await fetch(`${base}/api/functions/import-employees`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return (await response.json()) as ImportEmployeesResult;
  }

  const contentType = response.headers.get("content-type") || "";
  let errorMessage = `Import employees failed via proxy: HTTP ${response.status}`;

  if (contentType.includes("application/json")) {
    const errorBody = await response.json().catch(() => ({}));
    errorMessage = errorBody.error || errorMessage;
  }

  if (response.status === 401 && !forceRefresh) {
    return invokeImportEmployeesViaProxy(body, true);
  }

  throw new Error(errorMessage);
}

export async function invokeImportEmployees(body: {
  employees: ImportEmployeePayload[];
  update_duplicates?: boolean;
}) {
  try {
    return await invokeImportEmployeesDirect(body);
  } catch (error: any) {
    if (isUnauthorizedMessage(error?.message)) {
      await getCurrentOrRefreshedSession(true);

      try {
        return await invokeImportEmployeesDirect(body);
      } catch (retryError: any) {
        error = retryError;
      }
    }

    if (import.meta.env.DEV) {
      try {
        return await invokeImportEmployeesViaProxy(body);
      } catch (proxyError: any) {
        throw new Error(proxyError?.message || error?.message || "Import employees failed");
      }
    }

    throw error;
  }
}