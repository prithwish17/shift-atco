#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Queue poller and schedule index database tests.
#
# Starts a throwaway PostgreSQL cluster, loads a Supabase stand-in with pg_cron
# and pg_net replaced by recording fakes (fixture.sql), applies the current
# cron health migration and the two migrations under test, applies those two
# again to prove they are re-runnable, and runs the scenarios (scenarios.sql).
# Then it checks the index migration keeps the duplicates when the index that
# replaces them is missing. The cluster is deleted afterwards.
#
#   scripts/db-tests/queue-pollers/run.sh
#
# Needs PostgreSQL 14+ server binaries (initdb, pg_ctl, psql) and pg_trgm.
# Set PGBIN to pick a specific version. As root it re-runs itself as the
# `postgres` user, because initdb refuses to run as root.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATIONS="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"

if [[ "$(id -u)" == "0" ]]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/queue-pollers-XXXXXX")"
  cp "$HERE"/*.sql "$HERE/run.sh" "$WORK"/
  mkdir -p "$WORK/migrations"
  cp "$MIGRATIONS"/*.sql "$WORK/migrations"/
  chown -R postgres "$WORK"
  status=0
  runuser -u postgres -- env QUEUE_POLLERS_WORK="$WORK" PGBIN="${PGBIN:-}" bash "$WORK/run.sh" || status=$?
  rm -rf "$WORK"
  exit "$status"
fi

if [[ -n "${QUEUE_POLLERS_WORK:-}" ]]; then
  SQL_DIR="$QUEUE_POLLERS_WORK"
  MIGRATIONS="$QUEUE_POLLERS_WORK/migrations"
else
  SQL_DIR="$HERE"
fi

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/queue-pollers-pg-XXXXXX")"
PORT="${PORT:-55440}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$DATA/db" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA/db" -l "$DATA/server.log" -w \
  -o "-p $PORT -k $DATA -c listen_addresses=''" start >/dev/null

PSQL=("$PGBIN/psql" -h "$DATA" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

apply() {
  echo "→ $1"
  "${PSQL[@]}" -f "$2"
}

apply "fixture" "$SQL_DIR/fixture.sql"
apply "20260922120000_fix_cron_queue_health" "$MIGRATIONS/20260922120000_fix_cron_queue_health.sql"

# Migrations must be re-runnable: a second apply is a no-op, not an error.
for pass in "" " (again)"; do
  for m in \
    20261021100000_gate_queue_pollers \
    20261021110000_drop_duplicate_schedule_indexes; do
    apply "$m$pass" "$MIGRATIONS/$m.sql"
  done
done

apply "scenarios" "$SQL_DIR/scenarios.sql"

# Without the UNIQUE (employee_code, duty_date) index and the (duty_date,
# employee_code) index, the migration must drop nothing.
echo "→ index migration with its replacements missing"
"${PSQL[@]}" -c "
  ALTER TABLE public.employee_schedules DROP CONSTRAINT employee_schedules_employee_code_duty_date_key;
  DROP INDEX public.idx_employee_schedules_date_code;
  CREATE INDEX idx_employee_schedules_code_date ON public.employee_schedules (employee_code, duty_date);
  CREATE INDEX idx_schedules_emp_date_range     ON public.employee_schedules (employee_code, duty_date);
  CREATE INDEX idx_employee_schedules_duty_date ON public.employee_schedules (duty_date);"
"${PSQL[@]}" -f "$MIGRATIONS/20261021110000_drop_duplicate_schedule_indexes.sql" 2>&1 | grep -c WARNING \
  | grep -qx 2 || { echo "FAIL: expected two warnings"; exit 1; }
"${PSQL[@]}" -c "
  DO \$\$ BEGIN
    IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
          ('idx_employee_schedules_code_date', 'idx_schedules_emp_date_range', 'idx_employee_schedules_duty_date')) <> 3
    THEN RAISE EXCEPTION 'FAIL: an index was dropped without its replacement'; END IF;
    RAISE NOTICE 'ok   nothing dropped when the replacement indexes are missing';
  END \$\$;"

echo "queue-poller tests passed"
