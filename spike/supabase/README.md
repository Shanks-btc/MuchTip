# Supabase X-login identity spike

**Quick start (current):** `bash run-hardening.sh` runs the auth-hardening tests end to end (real GoTrue + Postgres in Docker,
X mocked) in three server configurations and cleans up after itself. It needs Docker running, free ports 9999/4010/2525, and
`@supabase/supabase-js@2.117.3` resolvable (`npm i @supabase/supabase-js@2.117.3` here, or set `NODE_PATH`). `edge-check.cjs` is the
strict check the Edge Function must apply; `test-hardening.cjs` tests it. `test.cjs` and `test6.cjs` below are the earlier
evidence runs and intentionally use the first-draft (lax) check. Results: `../../verified.md` sections 3b to 3d.

The rest of this file lists the manual commands used for those earlier runs.

Runs the real `supabase/auth` (GoTrue) server against a mocked X, to check what a signed-in user can change about
their identity and whether `auth.getUser(jwt)` -> `identities[provider 'x'].id` is a safe way to learn a user's X id.
Results are in ../../verified.md (items 3b / 3c). These are the exact commands that were run, one at a time
(they were **not** run as a single script). Requires Docker and `npm i @supabase/supabase-js@2.117.3` next to the scripts.

```
docker network create sbtest
docker pull supabase/gotrue:v2.197.0 ; docker pull supabase/postgres:15.19.0.002
MSYS_NO_PATHCONV=1 docker run -d --name sb-db --network sbtest -e POSTGRES_PASSWORD=postgres supabase/postgres:15.19.0.002
# once the db is up:
docker exec sb-db psql -U supabase_admin -h localhost -d postgres -c "alter role supabase_auth_admin with password 'postgres'"
# keys.json = { secret, anon, service }: a random 32-byte JWT secret and HS256 JWTs (role anon / service_role) signed with it
node mock-x.cjs &            # fake X on :4010
node smtp-sink.cjs &         # only needed when email confirmation is required
# GoTrue: see the env list in start_auth() of the session; the X-specific ones are
#   GOTRUE_EXTERNAL_X_ENABLED=true GOTRUE_EXTERNAL_X_CLIENT_ID=mock-client GOTRUE_EXTERNAL_X_SECRET=mock-secret
#   GOTRUE_EXTERNAL_X_REDIRECT_URI=http://localhost:9999/callback GOTRUE_EXTERNAL_X_URL=http://host.docker.internal:4010
node test.cjs                # sections 1-6 (email auto-confirm ON, manual linking default/off)
node test6.cjs victim@example.com   # pre-registration attack; run with email confirmation ON, then with the email provider OFF
```
