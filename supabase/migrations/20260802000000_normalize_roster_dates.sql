-- Normalise rosters.date to a single canonical format ("YYYY-MM-DD").
--
-- The roster webapp emits a different date shape per team/shift tab.  A survey of
-- all 16,875 rows found:
--   15,435  "2-Aug-2026"    (D-Mon-YYYY)   — parsed correctly by the frontend
--    1,062  "2-August-26"   (D-Month-YY)   — Bravo night: INVISIBLE in the UI
--      248  "9-May-26"      (D-Mon-YY)     — Bravo night: INVISIBLE in the UI
--       66  "07-30-2026"    (MM-DD-YYYY)   — Echo afternoon/night: INVISIBLE
--       64  "23"                           — unrecoverable junk from the sheet
--
-- The frontend only generated/parsed the D-Mon-YYYY family, so ~8.5% of rows were
-- unreachable by both the `.in("date", ...)` query and the client-side filter.
-- Converting everything to ISO makes those rows visible again and lets every
-- consumer match on one exact string.
--
-- Month names are mapped explicitly rather than via to_date(..., 'Mon'), whose
-- handling of full names ("August") vs abbreviations ("Aug") is not dependable.

-- 1. Alphabetic month forms: D-Mon-YYYY, D-Month-YYYY, D-Mon-YY, D-Month-YY.
WITH parsed AS (
  SELECT
    id,
    regexp_match(date, '^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$') AS m
  FROM public.rosters
  WHERE date ~ '^\d{1,2}-[A-Za-z]+-\d{2,4}$'
),
converted AS (
  SELECT
    id,
    make_date(
      -- 2-digit years in this data are all 20xx.
      CASE WHEN length(m[3]) <= 2 THEN 2000 + m[3]::int ELSE m[3]::int END,
      CASE lower(left(m[2], 3))
        WHEN 'jan' THEN 1  WHEN 'feb' THEN 2  WHEN 'mar' THEN 3
        WHEN 'apr' THEN 4  WHEN 'may' THEN 5  WHEN 'jun' THEN 6
        WHEN 'jul' THEN 7  WHEN 'aug' THEN 8  WHEN 'sep' THEN 9
        WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
      END,
      m[1]::int
    ) AS iso
  FROM parsed
  WHERE lower(left(m[2], 3)) IN
        ('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec')
    AND m[1]::int BETWEEN 1 AND 31
)
UPDATE public.rosters r
SET date = to_char(c.iso, 'YYYY-MM-DD')
FROM converted c
WHERE r.id = c.id;

-- 2. MM-DD-YYYY ("07-30-2026").  Only ever emitted by Echo; every observed value
--    has a day > 12 so month-first is unambiguous.  The range guard is expressed
--    in the regex to avoid an ::int cast running on non-matching rows.
WITH parsed AS (
  SELECT
    id,
    regexp_match(date, '^(\d{1,2})-(\d{1,2})-(\d{4})$') AS m
  FROM public.rosters
  WHERE date ~ '^(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])-\d{4}$'
)
UPDATE public.rosters r
SET date = to_char(make_date(m[3]::int, m[1]::int, m[2]::int), 'YYYY-MM-DD')
FROM parsed p
WHERE r.id = p.id;

-- Rows already in ISO, and unrecoverable values such as '23', are left alone;
-- ingestion now drops unparseable dates so no more will accumulate.

-- 3. Collapsing formats can make two previously distinct rows identical, which
--    would violate the unique constraint.  De-duplicate, keeping the newest.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY date, shift, team, employee_name, unit, position
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.rosters
)
DELETE FROM public.rosters r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;
