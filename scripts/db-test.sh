#!/usr/bin/env bash
# ============================================================================
# DB integration harness — migrations + seeds + SQL test suites on plain Postgres.
#
#   1. creates a throwaway TEMPLATE database (unique name)
#   2. installs the Supabase compatibility stub (testing/supabase_stub.sql)
#   3. applies EVERY file in supabase/migrations/*.sql in lexical (timestamp) order
#   4. loads supabase/seeds/*.sql in lexical order
#   5. for each suite, clones a FRESH database from the template and runs it:
#        testing/rls_test_suite.sql, testing/*_test*.sql, supabase/tests/*.sql,
#        tests/db/*.sql
#   6. fails if any suite errors, prints a FAIL line, or prints no PASS line
#   7. drops every database it created (set KEEP_DB=1 to keep them for debugging)
#
# Connection: standard libpq env vars, defaulting to the local dev/CI server:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
# The user must be able to CREATE DATABASE and create roles (superuser in CI).
#
# Usage:  npm run test:db            # or: bash scripts/db-test.sh
#         bash scripts/db-test.sh tests/db/tenant_isolation.sql   # one suite
# ============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=notice"

PREFIX="${DB_TEST_PREFIX:-clubos_test}_$(date +%s)_$$"
TEMPLATE_DB="${PREFIX}_tpl"
CREATED_DBS=()
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clubos-db-test.XXXXXX")"

if [[ -t 1 ]]; then RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; DIM=$'\e[2m'; RESET=$'\e[0m'; else RED=; GREEN=; YELLOW=; DIM=; RESET=; fi

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

cleanup() {
  local code=$?
  if [[ "${KEEP_DB:-0}" == "1" ]]; then
    echo "${YELLOW}KEEP_DB=1 — kept databases: ${CREATED_DBS[*]:-none}${RESET}"
  else
    for db in "${CREATED_DBS[@]}"; do
      psql_admin -c "drop database if exists \"$db\" with (force)" >/dev/null 2>&1 || true
    done
  fi
  if [[ $code -ne 0 ]]; then echo "${DIM}logs: $LOG_DIR${RESET}"; else rm -rf "$LOG_DIR"; fi
  exit $code
}
trap cleanup EXIT

create_db() { # name [template]
  local name="$1" tpl="${2:-template0}"
  psql_admin -c "create database \"$name\" template \"$tpl\"" >/dev/null
  CREATED_DBS+=("$name")
}

# Run one SQL file against a DB; abort the harness on the first error.
apply_file() { # db file
  local db="$1" file="$2"
  if ! psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$file" >"$LOG_DIR/apply.log" 2>&1; then
    echo "${RED}✗ failed applying $file${RESET}"
    grep -E "ERROR|FATAL" "$LOG_DIR/apply.log" | head -20 || tail -20 "$LOG_DIR/apply.log"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
echo "▶ Postgres: $PGUSER@$PGHOST:$PGPORT"
pg_isready -q -t 30 || { echo "${RED}Postgres is not reachable${RESET}"; exit 1; }

echo "▶ Building template database $TEMPLATE_DB"
create_db "$TEMPLATE_DB"
apply_file "$TEMPLATE_DB" testing/supabase_stub.sql
echo "  ✓ supabase compatibility stub"

shopt -s nullglob
migrations=(supabase/migrations/*.sql)
[[ ${#migrations[@]} -gt 0 ]] || { echo "${RED}no migrations found${RESET}"; exit 1; }

# Seed placement (see testing/seed_plan.conf): "after <migration> <seed>".
declare -A SEED_AFTER=()
declare -A SEED_EARLY=()
if [[ -f testing/seed_plan.conf ]]; then
  while read -r kw mig seed _; do
    [[ "$kw" == "after" && -n "${mig:-}" && -n "${seed:-}" ]] || continue
    [[ -f "$seed" ]] || { echo "${RED}seed_plan.conf: missing $seed${RESET}"; exit 1; }
    SEED_AFTER[$mig]="${SEED_AFTER[$mig]:-} $seed"
    SEED_EARLY[$seed]=1
  done < <(grep -vE '^\s*(#|$)' testing/seed_plan.conf)
fi

for m in "${migrations[@]}"; do
  apply_file "$TEMPLATE_DB" "$m"
  echo "  ✓ $m"
  for s in ${SEED_AFTER[$(basename "$m")]:-}; do
    apply_file "$TEMPLATE_DB" "$s"
    echo "  ✓ $s ${DIM}(seed, per testing/seed_plan.conf)${RESET}"
  done
done

for s in supabase/seeds/*.sql; do
  [[ -n "${SEED_EARLY[$s]:-}" ]] && continue
  apply_file "$TEMPLATE_DB" "$s"
  echo "  ✓ $s"
done

# Informational: do the migrations apply to an EMPTY database (fresh tenant
# project, `supabase db reset` before seeding)? EMPTY_DB_CHECK=strict makes it blocking.
if [[ "${EMPTY_DB_CHECK:-warn}" != "off" ]]; then
  empty_db="${PREFIX}_empty"
  create_db "$empty_db"
  psql -X -q -v ON_ERROR_STOP=1 -d "$empty_db" -f testing/supabase_stub.sql >/dev/null 2>&1
  empty_ok=1
  for m in "${migrations[@]}"; do
    if ! psql -X -q -v ON_ERROR_STOP=1 -d "$empty_db" -f "$m" >"$LOG_DIR/empty.log" 2>&1; then
      empty_ok=0
      msg="migrations do not apply to an empty database — first failure: $m: $(grep -m1 ERROR "$LOG_DIR/empty.log" | sed 's/.*ERROR: *//')"
      if [[ "${EMPTY_DB_CHECK:-warn}" == "strict" ]]; then echo "${RED}✗ $msg${RESET}"; exit 1; fi
      echo "${YELLOW}⚠ $msg${RESET}"
      echo "${DIM}  (non-blocking; see testing/seed_plan.conf — set EMPTY_DB_CHECK=strict to enforce)${RESET}"
      break
    fi
  done
  [[ $empty_ok -eq 1 ]] && echo "  ✓ all migrations apply to an empty database"
  psql_admin -c "drop database if exists \"$empty_db\" with (force)" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
if [[ $# -gt 0 ]]; then
  suites=("$@")
else
  # testing/*_test*.sql: per-track regression suites (platform, payments,
  # compliance, sports operations). Each runs once on its own fresh clone.
  suites=()
  for f in testing/rls_test_suite.sql testing/*_test.sql testing/*_test_suite.sql supabase/tests/*.sql tests/db/*.sql; do
    [[ " ${suites[*]} " == *" $f "* ]] || suites+=("$f")
  done
fi

# A failing assertion is a line that STARTS with FAIL — either query output
# ("FAIL — …") or a notice/exception ("psql:file:12: NOTICE:  FAIL — …").
FAIL_RE='^(psql:[^ ]+: )?((NOTICE|WARNING|ERROR|INFO): +)?FAIL'
# XFAIL = a tracked, known finding (non-blocking unless STRICT_KNOWN=1).
XFAIL_RE='^(psql:[^ ]+: )?((NOTICE|INFO): +)?XFAIL'
XPASS_RE='^(psql:[^ ]+: )?((NOTICE|INFO): +)?XPASS'
if [[ "${STRICT_KNOWN:-0}" == "1" ]]; then
  FAIL_RE='^(psql:[^ ]+: )?((NOTICE|WARNING|ERROR|INFO): +)?X?FAIL'
fi
PASS_RE='^(psql:[^ ]+: )?((NOTICE|INFO): +)?PASS'
ERROR_RE='^(psql:[^ ]+: )?(ERROR|FATAL):'

failed=0; total_pass=0; total_xfail=0; n=0
for suite in "${suites[@]}"; do
  n=$((n + 1))
  db="${PREFIX}_s${n}"
  log="$LOG_DIR/$(basename "$suite" .sql).log"
  create_db "$db" "$TEMPLATE_DB"
  set +e
  psql -X -d "$db" -f "$suite" >"$log" 2>&1
  rc=$?
  set -e
  passes=$(grep -cE "$PASS_RE" "$log" || true)
  fails=$(grep -cE "$FAIL_RE" "$log" || true)
  errors=$(grep -E "$ERROR_RE" "$log" | grep -vcE "$FAIL_RE" || true)
  # Suites that deliberately trigger errors (negative tests printed as
  # "EXPECT <CODE>") opt out of the error count with this header line:
  #   -- db-test: expected-errors
  if grep -q '^-- db-test: expected-errors' "$suite"; then errors=0; fi
  xfails=$(grep -cE "$XFAIL_RE" "$log" || true)
  xpasses=$(grep -cE "$XPASS_RE" "$log" || true)
  total_pass=$((total_pass + passes)); total_xfail=$((total_xfail + xfails))
  if [[ $rc -ne 0 || $fails -gt 0 || $errors -gt 0 || $passes -eq 0 ]]; then
    failed=$((failed + 1))
    echo "${RED}✗ $suite${RESET}  (pass=$passes fail=$fails errors=$errors exit=$rc)"
    grep -E "$FAIL_RE|$ERROR_RE" "$log" | sed 's/^/    /' | head -40
    [[ $passes -eq 0 ]] && echo "    (no PASS lines — suite did not run any assertion)"
  else
    extra=""
    [[ $xfails -gt 0 ]] && extra=", ${YELLOW}$xfails known finding(s) (XFAIL)${RESET}${DIM}"
    echo "${GREEN}✓ $suite${RESET}  ${DIM}($passes passed$extra)${RESET}"
    if [[ $xpasses -gt 0 ]]; then
      echo "    ${YELLOW}$xpasses known finding(s) now PASS — remove them from the known list:${RESET}"
      grep -E "$XPASS_RE" "$log" | sed 's/^/    /' | head -20
    fi
  fi
  if [[ "${VERBOSE:-0}" == "1" ]]; then sed 's/^/    /' "$log"; fi
  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    psql_admin -c "drop database if exists \"$db\" with (force)" >/dev/null 2>&1 || true
  fi
done

echo
if [[ $failed -gt 0 ]]; then
  echo "${RED}DB tests FAILED: $failed of ${#suites[@]} suite(s) failed${RESET}"
  exit 1
fi
echo "${GREEN}DB tests passed: ${#suites[@]} suite(s), $total_pass assertion(s), ${#migrations[@]} migration(s)${RESET}"
if [[ $total_xfail -gt 0 ]]; then
  echo "${YELLOW}$total_xfail known finding(s) tracked as XFAIL — run with VERBOSE=1 to list, STRICT_KNOWN=1 to enforce${RESET}"
fi
