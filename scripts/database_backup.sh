#!/usr/bin/env bash
set -euo pipefail
umask 077

for name in BACKUP_DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET BACKUP_ENCRYPTION_KEY; do
  [[ -n "${!name:-}" ]] || { echo "missing backup secret: $name" >&2; exit 1; }
done
[[ ${#BACKUP_ENCRYPTION_KEY} -ge 32 ]] || { echo 'BACKUP_ENCRYPTION_KEY must contain at least 32 characters' >&2; exit 1; }

workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
dump="$workdir/database.dump"
key="database/figocrm-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
encrypted="$workdir/$(basename "$key")"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true

# PostgreSQL 17 matches the current Supabase project. No plaintext dump leaves this runner.
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e BACKUP_DATABASE_URL -v "$workdir:/backup" postgres:17 \
  sh -c 'exec pg_dump --format=custom --compress=9 --no-owner --no-acl --file=/backup/database.dump "$BACKUP_DATABASE_URL"'
[[ -s "$dump" ]] || { echo 'pg_dump produced an empty file' >&2; exit 1; }

gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --compress-algo none \
  --output "$encrypted" "$dump" 3<<<"$BACKUP_ENCRYPTION_KEY"
[[ -s "$encrypted" ]] || { echo 'encryption produced an empty file' >&2; exit 1; }
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt "$encrypted" >/dev/null 3<<<"$BACKUP_ENCRYPTION_KEY"
rm -f -- "$dump"

aws s3 cp "$encrypted" "s3://${R2_BUCKET}/${key}" \
  --endpoint-url "$endpoint" --only-show-errors --no-progress
expected=$(stat -c %s "$encrypted")
actual=$(aws s3api head-object --bucket "$R2_BUCKET" --key "$key" \
  --endpoint-url "$endpoint" --query ContentLength --output text)
[[ "$actual" == "$expected" ]] || { echo 'R2 size verification failed' >&2; exit 1; }
echo "backup_uploaded key=$key bytes=$actual"

# Retention runs only after upload and size verification succeed.
python3 scripts/r2_backup_inventory.py prune "$key"
