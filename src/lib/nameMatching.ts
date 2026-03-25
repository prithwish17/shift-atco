const DESIGNATION_SUFFIXES = ["SM", "DGM", "MGR", "JE", "AM", "AGM"];

const trailingDesignationPattern = new RegExp(
  `\\s*-\\s*(?:${DESIGNATION_SUFFIXES.join("|")})\\s*$`,
  "i"
);

export function normalizeEmployeeMatchName(value: string | null | undefined) {
  if (!value) return "";

  return String(value)
    .toUpperCase()
    .split("/")[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(trailingDesignationPattern, " ")
    .replace(/[.,]+/g, " ")
    .replace(/[-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeEmployeeMatchName(left);
  const normalizedRight = normalizeEmployeeMatchName(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

export function buildNameIndex<T>(items: T[], getName: (item: T) => string | null | undefined) {
  const index = new Map<string, T[]>();

  items.forEach((item) => {
    const normalizedName = normalizeEmployeeMatchName(getName(item));
    if (!normalizedName) return;

    const existing = index.get(normalizedName);
    if (existing) {
      existing.push(item);
      return;
    }

    index.set(normalizedName, [item]);
  });

  return index;
}

export type NameMatchResult<T> =
  | { status: "unique"; match: T }
  | { status: "ambiguous"; count: number }
  | { status: "none" };

export function findNameMatch<T>(
  index: Map<string, T[]>,
  candidate: string | null | undefined,
): NameMatchResult<T> {
  const normalizedCandidate = normalizeEmployeeMatchName(candidate);
  if (!normalizedCandidate) return { status: "none" };

  const matches = index.get(normalizedCandidate) || [];
  if (matches.length === 1) return { status: "unique", match: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", count: matches.length };
  return { status: "none" };
}

export function findUniqueNameMatch<T>(
  index: Map<string, T[]>,
  candidate: string | null | undefined,
) {
  const result = findNameMatch(index, candidate);
  return result.status === "unique" ? result.match : null;
}

export function isUuidLike(value?: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}