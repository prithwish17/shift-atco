import { z } from "zod";

export interface EmployeeRecord {
  employee_id: string;
  initials: string;
  full_name: string;
  designation: string;
  stream: string;
  mobile: string;
  email: string;
  gender: string;
  alternate_email: string;
  address: string;
  current_shift: string;
}

const HEADER_MAP: Record<string, keyof EmployeeRecord> = {
  "emp. id": "employee_id",
  "emp id": "employee_id",
  "employee id": "employee_id",
  "initials": "initials",
  "employee name": "full_name",
  "name": "full_name",
  "designation": "designation",
  "stream alloted": "stream",
  "stream": "stream",
  "contact no.": "mobile",
  "contact no": "mobile",
  "mobile": "mobile",
  "phone": "mobile",
  "office email id": "email",
  "email": "email",
  "email id": "email",
  "gender": "gender",
  "alternate mail (gmail)": "alternate_email",
  "alternate mail": "alternate_email",
  "alternate email": "alternate_email",
  "address": "address",
  "shift name": "current_shift",
  "shift": "current_shift",
};

const SHIFT_MAP: Record<string, string> = {
  general: "general",
  gen: "general",
  g: "general",
  a: "a",
  "shift a": "a",
  b: "b",
  "shift b": "b",
  c: "c",
  "shift c": "c",
  d: "d",
  "shift d": "d",
  e: "e",
  "shift e": "e",
};

const employeeSchema = z.object({
  employee_id: z.string().min(1, "Employee ID is required"),
  full_name: z.string().min(1, "Employee Name is required"),
  email: z.string().email("Invalid email format"),
  current_shift: z.string().min(1, "Shift is required"),
});

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

export function mapHeaders(headers: string[]): { mapped: Record<number, keyof EmployeeRecord>; unmapped: string[] } {
  const mapped: Record<number, keyof EmployeeRecord> = {};
  const unmapped: string[] = [];

  headers.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    if (key === "sl. no" || key === "sl no" || key === "s.no" || key === "sno") return;
    const field = HEADER_MAP[key];
    if (field) {
      mapped[i] = field;
    } else {
      unmapped.push(h);
    }
  });

  return { mapped, unmapped };
}

export function mapShift(value: string): string {
  return SHIFT_MAP[value.toLowerCase().trim()] || "general";
}

export function rowsToRecords(
  rows: string[][],
  headerMap: Record<number, keyof EmployeeRecord>
): EmployeeRecord[] {
  return rows.map((row) => {
    const record: Partial<EmployeeRecord> = {};
    Object.entries(headerMap).forEach(([indexStr, field]) => {
      const val = row[Number(indexStr)] || "";
      record[field] = val;
    });
    // Normalize shift
    if (record.current_shift) {
      record.current_shift = mapShift(record.current_shift);
    }
    return record as EmployeeRecord;
  });
}

export function validateRecords(records: EmployeeRecord[]): {
  valid: EmployeeRecord[];
  errors: { index: number; messages: string[] }[];
} {
  const valid: EmployeeRecord[] = [];
  const errors: { index: number; messages: string[] }[] = [];

  records.forEach((rec, i) => {
    const result = employeeSchema.safeParse(rec);
    if (result.success) {
      valid.push(rec);
    } else {
      errors.push({
        index: i + 2, // 1-indexed + header row
        messages: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      });
    }
  });

  return { valid, errors };
}
