export type ShiftType = "MA" | "N";

export type DutyShift = "M" | "A" | "N";

export type RecommendationMode = "all" | "ope" | "exchange" | "compound";

export type RecommendationType = "ope" | "exchange" | "compound";

export interface SuggestedAction {
  action_type: "assign" | "swap" | "escalate";
  date: string;
  shift: ShiftType;
  group_name: string;
  employee_id: string | null;
  duty_code?: string;
  notes?: string;
}

export interface TeamSuggestionsRequest {
  date: string;
  group_name: string;
  shift: ShiftType;
  requested_by?: string;
  requested_count?: number;
  mode?: RecommendationMode;
}

export interface TeamSuggestionCandidate {
  employee_id: string;
  employee_name: string | null;
  source_team: string | null;
  current_duty_code: string | null;
  current_shift: ShiftType | null;
  groups: string[];
  score: number;
  reason: string;
  recommendation_type: RecommendationType;
  suggestion_type: "assign" | "swap";
  proposed_action: SuggestedAction;
}

export interface TeamSuggestionsResponse {
  generated_at: string;
  request: {
    date: string;
    group_name: string;
    shift: ShiftType;
    requested_by: string;
    requested_count: number;
    mode: RecommendationMode;
  };
  context: {
    current_available: number;
    configured_required: number | null;
  };
  warnings: string[];
  available_groups: string[];
  ope_suggestions: TeamSuggestionCandidate[];
  exchange_suggestions: TeamSuggestionCandidate[];
  compound_suggestions: TeamSuggestionCandidate[];
}

export interface ShortageDetail {
  group_name: string;
  shift: DutyShift;
  required: number;
  available: number;
  deficit: number;
  qualifying_ratings: string[];
}

export interface ShortageWithSuggestions {
  shortage: ShortageDetail;
  suggestions: TeamSuggestionCandidate[];
}

export interface DateScanRequest {
  date: string;
  requested_by?: string;
  requested_count?: number;
}

export interface DateScanResponse {
  generated_at: string;
  date: string;
  requested_by: string;
  shortages_found: number;
  shortages: ShortageWithSuggestions[];
  warnings: string[];
}

export interface TeamOption {
  group_name: string;
  ma_required: number | null;
  n_required: number | null;
}

export interface TeamOptionsResponse {
  generated_at: string;
  date: string;
  groups: TeamOption[];
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function buildAuthHeaders(accessToken?: string) {
  return accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
      }
    : undefined;
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(new URL(path, `${trimTrailingSlash(baseUrl)}/`).toString(), {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const errorPayload = payload as { message?: string; detail?: string } | null;
    const message = errorPayload?.message || errorPayload?.detail || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function fetchTeamOptions(baseUrl: string, date: string, accessToken?: string): Promise<TeamOptionsResponse> {
  const query = new URLSearchParams({ date });
  return requestJson<TeamOptionsResponse>(baseUrl, `/team-options?${query.toString()}`, {
    headers: buildAuthHeaders(accessToken),
  });
}

export function fetchTeamSuggestions(
  baseUrl: string,
  request: TeamSuggestionsRequest,
  accessToken?: string,
): Promise<TeamSuggestionsResponse> {
  return requestJson<TeamSuggestionsResponse>(baseUrl, "/team-suggestions", {
    method: "POST",
    body: JSON.stringify(request),
    headers: buildAuthHeaders(accessToken),
  });
}

export function fetchDateScan(
  baseUrl: string,
  request: DateScanRequest,
  accessToken?: string,
): Promise<DateScanResponse> {
  return requestJson<DateScanResponse>(baseUrl, "/date-scan", {
    method: "POST",
    body: JSON.stringify(request),
    headers: buildAuthHeaders(accessToken),
  });
}