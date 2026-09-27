#!/usr/bin/env bash
# Exercise application and Auth pg_dump/pg_restore against two disposable databases in CI.
# Managed Supabase service schemas need a Supabase target and are outside this local drill.
set -euo pipefail
umask 077

for name in DATABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  [[ -n "${!name:-}" ]] || { echo "missing CI restore setting: $name" >&2; exit 1; }
done

python3 - <<'PY'
import os
from urllib.parse import urlparse

url = urlparse(os.environ['DATABASE_URL'])
if url.scheme not in ('postgresql', 'postgres') or url.hostname not in ('127.0.0.1', 'localhost', '::1'):
    raise SystemExit('CI restore source must be a disposable database on loopback')
PY

# The existing restore validator requires a nonempty profiles table.
node <<'NODE'
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
admin.auth.admin.createUser({
  email: `ci-restore-${randomUUID()}@figocrm.test`,
  password: `Ci-${randomUUID()}-Aa9!`,
  email_confirm: true,
}).then(({ error }) => {
  if (error) throw error;
}).catch(() => {
  console.error('Could not create disposable restore fixture');
  process.exitCode = 1;
});
NODE

workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
archive="$workdir/archive.dump"
target="figocrm_restore_drill"
export RESTORE_DATABASE_URL
RESTORE_DATABASE_URL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
url = urlparse(os.environ['DATABASE_URL'])
print(urlunparse(url._replace(path='/figocrm_restore_drill')))
PY
)

docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e DATABASE_URL -v "$workdir:/backup" postgres:17 \
  sh -c 'exec pg_dump --schema=auth --schema=public --format=custom --compress=9 --no-owner --no-acl --file=/backup/archive.dump "$DATABASE_URL"'
[[ -s "$archive" ]] || { echo 'CI pg_dump produced an empty archive' >&2; exit 1; }

docker run --rm --network host -e DATABASE_URL postgres:17 \
  sh -c 'exec psql --set=ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE DATABASE figocrm_restore_drill"'

docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e RESTORE_DATABASE_URL -v "$workdir:/backup:ro" postgres:17 \
  sh -c 'exec pg_restore --no-owner --no-acl --single-transaction --exit-on-error --dbname="$RESTORE_DATABASE_URL" /backup/archive.dump'

docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e RESTORE_DATABASE_URL -v "$PWD/scripts/restore_validation.sql:/backup/validate.sql:ro" postgres:17 \
  sh -c 'exec psql --set=ON_ERROR_STOP=1 --dbname="$RESTORE_DATABASE_URL" --file=/backup/validate.sql'

echo 'local_restore_drill_pass'
