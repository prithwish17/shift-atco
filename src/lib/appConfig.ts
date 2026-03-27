export const APP_NAME = "Atcora";
export const APP_SUPPORT_EMAIL = "admin@atcora.in";

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function getFunctionsProxyBaseUrl() {
  const configuredBase = import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL?.trim();

  if (configuredBase) {
    return trimTrailingSlash(configuredBase);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }

  return "https://atcora.in";
}