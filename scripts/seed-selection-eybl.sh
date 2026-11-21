#!/usr/bin/env bash
# Configure the founding club's EYBL team as a selection programme (data only).
#
#   DATABASE_URL=postgres://... scripts/seed-selection-eybl.sh
#
# Safe to rerun: it only adds what is missing (programme "EYBL 2026-27",
# divisions U14 / U16 with their teams, packages 1 / 2 / 3 tournaments with
# their instalment rules, head / assistant coaches) and never overwrites what
# the club changed in the app. Does nothing when the organisation does not
# exist. Requires migration 20250420102600_selection_programs.sql.
# The SQL lives in supabase/seeds/selection_eybl_dlang.sql (skipped by the
# test harness; tests/db/selection_programs.sql runs it twice).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?Set DATABASE_URL to the project database connection string}"
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seeds/selection_eybl_dlang.sql"
echo "EYBL selection programme configured (slug: eybl). Review it in Admin > Selection programmes."
