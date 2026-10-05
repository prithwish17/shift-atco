#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Leave ledger database tests.
#
# Starts a throwaway PostgreSQL cluster, loads a minimal Supabase stand-in
# (fixture.sql), applies the existing leave migrations, seeds the pre-migration
# state (seed.sql), applies the 20261005 leave ledger migrations, and runs the
# scenarios (scenarios.sql). The cluster is deleted afterwards.
#
#   scripts/db-tests/leave-ledger/run.sh
#
# Needs PostgreSQL 14+ server binaries (initdb, pg_ctl, psql) and btree_gist.
# Set PGBIN to pick a specific version. As root it re-runs itself as the
# `postgres` user, because initdb refuses to run as root.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATIONS="${MIGRATIONS_DIR:-$ROOT/supabase/migrations}"

if [[ "$(id -u)" == "0" ]]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/leave-ledger-XXXXXX")"
  cp "$HERE"/*.sql "$HERE/run.sh" "$WORK"/
  mkdir -p "$WORK/migrations"
  cp "$MIGRATIONS"/*.sql "$WORK/migrations"/
  chown -R postgres "$WORK"
  status=0
  runuser -u postgres -- env LEAVE_LEDGER_WORK="$WORK" PGBIN="${PGBIN:-}" bash "$WORK/run.sh" || status=$?
  rm -rf "$WORK"
  exit "$status"
fi

if [[ -n "${LEAVE_LEDGER_WORK:-}" ]]; then
  SQL_DIR="$LEAVE_LEDGER_WORK"
  MIGRATIONS="$LEAVE_LEDGER_WORK/migrations"
else
  SQL_DIR="$HERE"
fi

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/leave-ledger-pg-XXXXXX")"
PORT="${PORT:-55439}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
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

for m in \
  20260404000000_leave_production_hardening \
  20260508_leave_balance_deduction \
  20260816100000_leave_backfill_foundation \
  20260816110000_leave_backfill_rpcs; do
  apply "$m" "$MIGRATIONS/$m.sql"
done

apply "seed" "$SQL_DIR/seed.sql"

for m in \
  20261005100000_leave_sheet_sources_and_safe_sync \
  20261005110000_leave_register_on_approval; do
  apply "$m" "$MIGRATIONS/$m.sql"
done

# Migrations must be re-runnable: a second apply is a no-op, not an error.
for m in \
  20261005100000_leave_sheet_sources_and_safe_sync \
  20261005110000_leave_register_on_approval; do
  apply "$m (again)" "$MIGRATIONS/$m.sql"
done

apply "scenarios" "$SQL_DIR/scenarios.sql"
