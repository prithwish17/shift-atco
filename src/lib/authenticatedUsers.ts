import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

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

export async function fetchAuthenticatedUsers() {
  return invokeEdgeFunction<AuthenticatedUsersResponse>("authenticated-users");
}
