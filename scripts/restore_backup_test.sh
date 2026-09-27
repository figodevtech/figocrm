#!/usr/bin/env bash
# Run only against a disposable local Supabase/Postgres instance.
set -euo pipefail
umask 077

[[ $# -eq 1 && "$1" =~ ^database/figocrm-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$ ]] || {
  echo 'usage: restore_backup_test.sh database/figocrm-YYYYMMDDTHHMMSSZ.dump.gpg' >&2; exit 1;
}
for name in RESTORE_DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET BACKUP_ENCRYPTION_KEY; do
  [[ -n "${!name:-}" ]] || { echo "missing restore setting: $name" >&2; exit 1; }
done
python3 - <<'PY'
import os
from urllib.parse import urlparse
url = urlparse(os.environ['RESTORE_DATABASE_URL'])
if url.scheme not in ('postgresql', 'postgres') or url.hostname not in ('127.0.0.1', 'localhost', '::1'):
    raise SystemExit('RESTORE_DATABASE_URL must point to a disposable database on loopback')
PY

workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
encrypted="$workdir/archive.dump.gpg"
dump="$workdir/archive.dump"

aws s3 cp "s3://${R2_BUCKET}/$1" "$encrypted" \
  --endpoint-url "$endpoint" --only-show-errors --no-progress
[[ -s "$encrypted" ]] || { echo 'downloaded backup is empty' >&2; exit 1; }
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt --output "$dump" "$encrypted" 3<<<"$BACKUP_ENCRYPTION_KEY"
[[ -s "$dump" ]] || { echo 'decrypted backup is empty' >&2; exit 1; }

docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$workdir:/backup:ro" postgres:17 \
  pg_restore --list /backup/archive.dump > "$workdir/archive.list"
[[ -s "$workdir/archive.list" ]] || { echo 'pg_restore found no archive entries' >&2; exit 1; }

# The caller starts and destroys this isolated database. The loopback guard prevents production writes.
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e RESTORE_DATABASE_URL -v "$workdir:/backup:ro" postgres:17 \
  sh -c 'exec pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error --dbname="$RESTORE_DATABASE_URL" /backup/archive.dump'
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e RESTORE_DATABASE_URL -v "$PWD/scripts/restore_validation.sql:/backup/validate.sql:ro" postgres:17 \
  sh -c 'exec psql --set=ON_ERROR_STOP=1 --dbname="$RESTORE_DATABASE_URL" --file=/backup/validate.sql'
echo "restore_drill_pass key=$1"
