#!/usr/bin/env python3
"""Verify backup freshness and prune only recognized backup object keys."""
import datetime as dt
import json
import os
import re
import subprocess
import sys

KEY = re.compile(r"^database/figocrm-(\d{8})T\d{6}Z\.dump\.gpg$")


def settings():
    account = os.environ.get("R2_ACCOUNT_ID", "")
    bucket = os.environ.get("R2_BUCKET", "")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise RuntimeError("invalid R2 account ID or bucket")
    return bucket, f"https://{account}.r2.cloudflarestorage.com"


def aws(*args):
    bucket, endpoint = settings()
    return subprocess.check_output(
        ["aws", "s3api", *args, "--bucket", bucket, "--endpoint-url", endpoint, "--output", "json"],
        text=True,
    )


def objects():
    result = json.loads(aws("list-objects-v2", "--prefix", "database/figocrm-"))
    return sorted(
        (obj for obj in result.get("Contents", []) if KEY.fullmatch(obj["Key"]) and obj["Size"] > 0),
        key=lambda obj: obj["Key"],
        reverse=True,
    )


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    found = objects()
    if mode == "health":
        if not found:
            raise RuntimeError("backup_missing")
        latest = found[0]
        created = dt.datetime.fromisoformat(latest["LastModified"].replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc) - created
        if age > dt.timedelta(hours=36):
            raise RuntimeError("backup_older_than_36_hours")
        print(f"backup_healthy key={latest['Key']} age_hours={age.total_seconds() / 3600:.1f}")
    elif mode == "prune" and len(sys.argv) == 3:
        new_key = sys.argv[2]
        if not KEY.fullmatch(new_key) or not any(obj["Key"] == new_key for obj in found):
            raise RuntimeError("new_backup_not_found")
        keep_dates = []
        for obj in found:
            day = KEY.fullmatch(obj["Key"]).group(1)
            if day not in keep_dates:
                keep_dates.append(day)
            if len(keep_dates) == 7:
                break
        # Keep the newest backup from each of the latest seven UTC dates.
        kept = set()
        for obj in found:
            day = KEY.fullmatch(obj["Key"]).group(1)
            if day in keep_dates and day not in kept:
                kept.add(day)
                continue
            aws("delete-object", "--key", obj["Key"])
        print(f"backup_retention days={len(kept)}")
    else:
        raise RuntimeError("usage: r2_backup_inventory.py health | prune KEY")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"backup_monitor_failed: {error}", file=sys.stderr)
        sys.exit(1)
