import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

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

export async function invokeImportEmployees(body: {
  employees: ImportEmployeePayload[];
  update_duplicates?: boolean;
}) {
  return invokeEdgeFunction<ImportEmployeesResult>("import-employees", { ...body });
}
