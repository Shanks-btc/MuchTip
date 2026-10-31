#!/usr/bin/env bash
# Integration tests for the Edge Functions against REAL services, with X mocked:
#   Postgres (supabase/postgres) + GoTrue (supabase/auth) + PostgREST, all in Docker, with the migrations in
#   supabase/migrations applied; a tiny gateway (inside the test) puts them behind one URL like a Supabase project.
#   The functions run as real HTTP servers under Deno (the same index.ts files that get deployed).
#   X is mocked twice: spike/supabase/mock-x.cjs for the OAuth login GoTrue performs, and a fake X API for `resolve`.
#   The contract side is READ-ONLY against the live DogeOS Chikyū RPC: no transaction is ever sent, no DOGE is spent.
#
#   bash supabase/tests/run-integration.sh
#
# Needs: Docker running, Deno (DENO=/path/to/deno if not on PATH), Node, `npm ci` done (the spike's mock uses no packages).
# Optional: the repo's .env with VERIFIER_PRIVATE_KEY (the live contract's test verifier). Without it the tests that
# need to sign against the live contract are skipped and say so.
# Uses ports 9999 (GoTrue), 3000 (PostgREST), 54321 (gateway), 4010 (mock X login), 2525 (SMTP sink), 4020 (fake X API),
# 8780-8799 (functions; 8789 must be reachable from the DB container for the pg_cron test). Removes only the mt-* containers and the mtnet network it creates.
set -u
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1   # Git Bash on Windows must not rewrite /paths inside docker arguments
ROOT=$(cd ../.. && pwd)
GOTRUE=supabase/gotrue:v2.197.0
PG=supabase/postgres:15.19.0.002
REST=postgrest/postgrest:v16.5
DENO=${DENO:-deno}

command -v "$DENO" >/dev/null || { echo "deno not found (set DENO=/path/to/deno)"; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running"; exit 2; }
for p in 9999 3000 54321 4010 2525 4020; do
  netstat -ano 2>/dev/null | grep -E "[:.]$p " | grep -q LISTEN && { echo "port $p is busy"; exit 2; }
done

# MSYS path conversion is off (docker needs that), so hand native programs (node, deno) Windows-style paths explicitly.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
W=$(mktemp -d)   # keys, mock-mail log; removed on exit
WN=$(native "$W"); ROOTN=$(native "$ROOT")
MOCK_PID=""; SMTP_PID=""
# On Git Bash `kill` only reaches the MSYS pid, not the Windows process behind it: use the Windows pid when there is one.
stop_pid() {
  [ -z "${1:-}" ] && return 0
  local w; w=$(cat "/proc/$1/winpid" 2>/dev/null) && taskkill //F //PID "$w" >/dev/null 2>&1
  kill "$1" 2>/dev/null
  return 0
}
cleanup() {
  stop_pid "$MOCK_PID"; stop_pid "$SMTP_PID"
  docker rm -f mt-auth mt-rest mt-db >/dev/null 2>&1
  docker network rm mtnet >/dev/null 2>&1
  sleep 1; rm -rf "$W" 2>/dev/null || true
}
trap cleanup EXIT

# Fresh test-only keys: a random JWT secret plus HS256 JWTs for the anon and service_role roles.
node -e '
const c = require("crypto"), fs = require("fs");
const secret = c.randomBytes(32).toString("hex");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => { const h = b({ alg: "HS256", typ: "JWT" }), now = Math.floor(Date.now() / 1000), p = b({ role, iss: "supabase-test", iat: now, exp: now + 86400 });
  return `${h}.${p}.${c.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`; };
fs.writeFileSync(process.argv[1], JSON.stringify({ secret, anon: jwt("anon"), service: jwt("service_role") }));' "$WN/keys.json" || exit 3
SECRET=$(node -pe "require('$WN/keys.json').secret")

docker rm -f mt-auth mt-rest mt-db >/dev/null 2>&1
docker network create mtnet >/dev/null 2>&1 || true
docker run -d --name mt-db --network mtnet --add-host host.docker.internal:host-gateway -e POSTGRES_PASSWORD=postgres "$PG" >/dev/null || exit 3
echo "waiting for Postgres roles..."
PSQL=(docker exec -e PGPASSWORD=postgres mt-db psql -h localhost -d postgres -v ON_ERROR_STOP=1 -tA)
for _ in $(seq 1 60); do "${PSQL[@]}" -U supabase_admin -c "select 1 from pg_roles where rolname='service_role'" 2>/dev/null | grep -q 1 && break; sleep 3; done
sleep 8   # the image's init scripts keep running briefly after the roles appear
"${PSQL[@]}" -U supabase_admin -c "alter role supabase_auth_admin with password 'postgres'" >/dev/null
"${PSQL[@]}" -U supabase_admin -c "alter role authenticator with password 'postgres'" >/dev/null

echo "applying migrations (as the postgres role, like a hosted project)..."
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  $(basename "$f")"
  docker exec -i -e PGPASSWORD=postgres mt-db psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || { echo "MIGRATION FAILED: $f"; exit 4; }
done

# `exec` makes each subshell BE the node process, so $! is the pid of node itself (and the cwd is the temp dir, for mail.log)
( cd "$W" && exec node "$ROOTN/spike/supabase/mock-x.cjs" > mock-x.log 2>&1 ) &
MOCK_PID=$!
( cd "$W" && exec node "$ROOTN/spike/supabase/smtp-sink.cjs" > smtp.log 2>&1 ) &
SMTP_PID=$!

# Permissive GoTrue on purpose: email sign-up (auto-confirmed), anonymous sign-in and manual linking are all ON, so the
# test can create every kind of non-X or multi-identity user the claim gate must refuse.
docker run -d --name mt-auth --network mtnet -p 9999:9999 --add-host host.docker.internal:host-gateway \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@mt-db:5432/postgres" \
  -e GOTRUE_SITE_URL=http://localhost:3999 -e GOTRUE_URI_ALLOW_LIST="http://localhost:3999/**" \
  -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_X_ENABLED=true -e GOTRUE_EXTERNAL_X_CLIENT_ID=mock-client -e GOTRUE_EXTERNAL_X_SECRET=mock-secret \
  -e GOTRUE_EXTERNAL_X_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback -e GOTRUE_EXTERNAL_X_URL=http://host.docker.internal:4010 \
  -e GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true -e GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true \
  -e GOTRUE_SMTP_HOST=host.docker.internal -e GOTRUE_SMTP_PORT=2525 -e GOTRUE_SMTP_ADMIN_EMAIL=admin@example.com \
  "$GOTRUE" >/dev/null || exit 3

# PostgREST connects as `authenticator` and switches to the role in the request's JWT (anon / authenticated / service_role).
docker run -d --name mt-rest --network mtnet -p 3000:3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@mt-db:5432/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$SECRET" -e PGRST_SERVER_HOST=0.0.0.0 \
  "$REST" >/dev/null || exit 3

echo "waiting for GoTrue and PostgREST..."
for _ in $(seq 1 40); do curl -s -m 2 http://localhost:9999/health >/dev/null && break; sleep 2; done
ANON=$(node -pe "require('$WN/keys.json').anon")
for _ in $(seq 1 40); do curl -s -m 2 -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" http://localhost:3000/ | grep -q 200 && break; sleep 2; done
curl -s -m 2 http://localhost:9999/health | grep -q . || { echo "GoTrue did not become healthy"; docker logs mt-auth 2>&1 | tail -5; exit 5; }

echo; echo "################ running the integration tests"
IT_KEYS="$WN/keys.json" IT_ROOT="$ROOTN" "$DENO" test --allow-all --no-prompt integration_test.ts
STATUS=$?
echo; [ $STATUS -eq 0 ] && echo "INTEGRATION TESTS PASSED" || echo "INTEGRATION TESTS FAILED (exit $STATUS)"
exit $STATUS
