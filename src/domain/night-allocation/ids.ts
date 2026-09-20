/**
 * Duty ids. They identify a duty inside one editing session — the database
 * assigns its own uuid on save — so a counter plus a random suffix is enough,
 * and avoids depending on `crypto` being present in every runtime that loads
 * this module.
 */
let counter = 0;

export function makeDutyId(prefix = "d"): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
