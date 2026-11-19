#!/usr/bin/env bash
# Post-deploy smoke test. Usage:
#   scripts/deploy/smoke-test.sh https://app.example.com [HEALTH_CHECK_TOKEN]
# Exits non-zero on the first failed check. Read-only: creates no data.
set -euo pipefail

BASE="${1:?usage: smoke-test.sh <base-url> [health-token]}"
BASE="${BASE%/}"
TOKEN="${2:-${HEALTH_CHECK_TOKEN:-}}"
fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "OK    $*"; }

# 1. Liveness
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health?probe=live")
[ "$code" = "200" ] || fail "liveness returned $code"
ok "liveness"

# 2. Readiness (database + config)
if [ -n "$TOKEN" ]; then
  body=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/health")
else
  body=$(curl -s "$BASE/api/health")
fi
echo "$body" | grep -q '"status":"ok"' || { echo "$body"; fail "readiness is not ok"; }
echo "$body" | grep -q '"database":{"status":"ok"' || fail "database check not ok"
ok "readiness: $(echo "$body" | grep -o '"version":"[^"]*"' | head -1) $(echo "$body" | grep -o '"region":"[^"]*"' | head -1)"

# 3. Public pages render
for path in /login; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  [ "$code" = "200" ] || fail "$path returned $code"
  ok "$path"
done

# 4. Protected area redirects when signed out (auth middleware active)
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/dashboard")
case "$code" in 307|308|302|303) ok "/admin/dashboard redirects signed-out users ($code)";; *) fail "/admin/dashboard returned $code (expected redirect)";; esac

# 5. Stripe webhook rejects unsigned requests (must NOT be 2xx or a login redirect)
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stripe/webhook" -d '{}')
case "$code" in 400|503) ok "stripe webhook rejects unsigned request ($code)";; *) fail "stripe webhook returned $code (expected 400, or 503 if Stripe not configured)";; esac

# 6. Security headers
hdrs=$(curl -sI "$BASE/login")
echo "$hdrs" | grep -qi '^x-content-type-options: nosniff' || echo "WARN  X-Content-Type-Options missing (set via vercel.json or reverse proxy)"
echo "$hdrs" | grep -qi '^strict-transport-security' || echo "WARN  HSTS missing"

echo "Smoke test passed for $BASE"
