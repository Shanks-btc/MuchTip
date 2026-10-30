#!/usr/bin/env bash
# Starts a real supabase/auth (GoTrue) + Postgres in Docker, with X mocked on the host, and runs test-hardening.cjs
# in three server configurations ("permissive", "hardened", and "default-email"). Removes ONLY the sb-* containers and the sbtest network
# it created. Needs Docker running, `npm i @supabase/supabase-js@2.117.3` (or NODE_PATH pointing at one), and free
# ports 9999, 4010, 2525.
set -u
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1   # Git Bash on Windows must not rewrite /paths inside docker arguments
GOTRUE=supabase/gotrue:v2.197.0
PG=supabase/postgres:15.19.0.002
DB=(docker exec sb-db psql -U supabase_admin -h localhost -d postgres -tA)

[ -f keys.json ] || node make-keys.cjs
SECRET=$(node -pe "require('./keys.json').secret")
MOCK_PID=""; SMTP_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "$SMTP_PID" ] && kill "$SMTP_PID" 2>/dev/null
  docker rm -f sb-auth sb-db >/dev/null 2>&1
  docker network rm sbtest >/dev/null 2>&1
}
trap cleanup EXIT

docker rm -f sb-auth sb-db >/dev/null 2>&1
docker network create sbtest >/dev/null 2>&1 || true
docker run -d --name sb-db --network sbtest -e POSTGRES_PASSWORD=postgres "$PG" >/dev/null || exit 3
echo "waiting for Postgres roles..."
for _ in $(seq 1 60); do "${DB[@]}" -c "select 1 from pg_roles where rolname='supabase_auth_admin'" 2>/dev/null | grep -q 1 && break; sleep 3; done
sleep 8   # the image's init scripts keep running briefly after the role appears
"${DB[@]}" -c "alter role supabase_auth_admin with password 'postgres'" >/dev/null

node mock-x.cjs > mock-x.log 2>&1 & MOCK_PID=$!
node smtp-sink.cjs > smtp.log 2>&1 & SMTP_PID=$!

start_auth() {  # args: extra "-e KEY=VAL" pairs
  docker rm -f sb-auth >/dev/null 2>&1
  docker run -d --name sb-auth --network sbtest -p 9999:9999 --add-host host.docker.internal:host-gateway \
    -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:9999 \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@sb-db:5432/postgres" \
    -e GOTRUE_SITE_URL=http://localhost:3000 -e GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" \
    -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_DISABLE_SIGNUP=false \
    -e GOTRUE_EXTERNAL_X_ENABLED=true -e GOTRUE_EXTERNAL_X_CLIENT_ID=mock-client -e GOTRUE_EXTERNAL_X_SECRET=mock-secret \
    -e GOTRUE_EXTERNAL_X_REDIRECT_URI=http://localhost:9999/callback -e GOTRUE_EXTERNAL_X_URL=http://host.docker.internal:4010 \
    -e GOTRUE_SMTP_HOST=host.docker.internal -e GOTRUE_SMTP_PORT=2525 -e GOTRUE_SMTP_ADMIN_EMAIL=admin@example.com \
    "$@" "$GOTRUE" >/dev/null || return 1
  for _ in $(seq 1 40); do curl -s -m 2 http://localhost:9999/health >/dev/null && return 0; sleep 2; done
  echo "auth did not become healthy"; docker logs sb-auth 2>&1 | tail -3; return 1
}

STATUS=0
echo; echo "################ PERMISSIVE server (email + auto-confirm, anonymous, manual linking ON)"
start_auth -e GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
           -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true -e GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true || exit 4
"${DB[@]}" -c "truncate auth.users cascade" >/dev/null
node test-hardening.cjs permissive || STATUS=1

echo; echo "################ HARDENED server (email, phone, anonymous, manual linking OFF)"
start_auth -e GOTRUE_EXTERNAL_X_EMAIL_OPTIONAL=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=false -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_MAILER_AUTOCONFIRM=false \
           -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false -e GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=false || exit 4
"${DB[@]}" -c "truncate auth.users cascade" >/dev/null
node test-hardening.cjs hardened || STATUS=1

echo; echo "################ GoTrue DEFAULT for X (email NOT optional): documents that email-less X accounts cannot sign in"
start_auth -e GOTRUE_EXTERNAL_EMAIL_ENABLED=false -e GOTRUE_MAILER_AUTOCONFIRM=false || exit 4
"${DB[@]}" -c "truncate auth.users cascade" >/dev/null
node test-hardening.cjs default-email || STATUS=1

echo; [ $STATUS -eq 0 ] && echo "ALL MODES PASSED" || echo "SOME CHECKS FAILED"
exit $STATUS
