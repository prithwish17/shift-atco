export const APP_NAME = "Atcora";
export const APP_SUPPORT_EMAIL = "admin@atcora.in";
const DEFAULT_APP_BASE_URL = "https://atcora.in";
const DEFAULT_FUNCTIONS_PROXY_BASE_URL = "https://www.atcora.in";
const DEFAULT_ROSTER_AUTOMATION_API_URL = "http://localhost:4000";
const LEGACY_PROXY_HOSTS = new Set(["shift-atco.vercel.app"]);

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function normalizeFunctionsProxyBaseUrl(value: string) {
  const trimmedValue = trimTrailingSlash(value);

  try {
    const url = new URL(trimmedValue);
    if (LEGACY_PROXY_HOSTS.has(url.hostname)) {
      return DEFAULT_FUNCTIONS_PROXY_BASE_URL;
    }
    return trimTrailingSlash(url.toString());
  } catch {
    return trimmedValue;
  }
}

function isLocalhostUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function getAppBaseUrl() {
  const configuredBase = import.meta.env.VITE_APP_BASE_URL?.trim();

  if (configuredBase) {
    return trimTrailingSlash(configuredBase);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = trimTrailingSlash(window.location.origin);

    if (!isLocalhostUrl(origin)) {
      return origin;
    }
  }

  return DEFAULT_APP_BASE_URL;
}

export function getAppUrl(path = "/") {
  return new URL(path, `${getAppBaseUrl()}/`).toString();
}

export function getFunctionsProxyBaseUrl() {
  const configuredBase = import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL?.trim();

  if (configuredBase) {
    return normalizeFunctionsProxyBaseUrl(configuredBase);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }

  return DEFAULT_FUNCTIONS_PROXY_BASE_URL;
}

export function getRosterAutomationApiBaseUrl() {
  const configuredBase = import.meta.env.VITE_ROSTER_AUTOMATION_API_URL?.trim();

  if (configuredBase) {
    return trimTrailingSlash(configuredBase);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = trimTrailingSlash(window.location.origin);

    if (isLocalhostUrl(origin)) {
      return DEFAULT_ROSTER_AUTOMATION_API_URL;
    }
  }

  return null;
}