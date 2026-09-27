import datetime as dt
import importlib.util
import json
import pathlib
import sys
from unittest.mock import patch

module_path = pathlib.Path(__file__).parents[2] / "scripts" / "r2_backup_inventory.py"
spec = importlib.util.spec_from_file_location("r2_backup_inventory", module_path)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)

now = dt.datetime.now(dt.timezone.utc)
objects = []
for days_ago in range(8):
    day = (now - dt.timedelta(days=days_ago)).strftime("%Y%m%d")
    objects.append({"Key": f"database/figocrm-{day}T032000Z.dump.gpg", "Size": 1024, "LastModified": now.isoformat()})
objects.append({"Key": f"database/figocrm-{now.strftime('%Y%m%d')}T012000Z.dump.gpg", "Size": 1024, "LastModified": now.isoformat()})
objects.append({"Key": "database/unrelated.dump.gpg", "Size": 1024, "LastModified": now.isoformat()})
objects.sort(key=lambda obj: obj["Key"], reverse=True)
new_key = next(obj["Key"] for obj in objects if obj["Key"].endswith("T032000Z.dump.gpg"))
deleted = []


def fake_aws(operation, *args):
    if operation == "list-objects-v2":
        return json.dumps({"Contents": objects})
    if operation == "delete-object":
        deleted.append(args[1])
        return "{}"
    raise AssertionError(operation)

with patch.object(inventory, "aws", side_effect=fake_aws):
    with patch.object(sys, "argv", ["r2_backup_inventory.py", "prune", new_key]):
        inventory.main()

assert new_key not in deleted
assert len(deleted) == 2  # older day plus older copy from current day
assert "database/unrelated.dump.gpg" not in deleted

with patch.object(inventory, "aws", side_effect=fake_aws):
    with patch.object(sys, "argv", ["r2_backup_inventory.py", "health"]):
        inventory.main()

stale = [{**objects[0], "LastModified": (now - dt.timedelta(hours=37)).isoformat()}]
with patch.object(inventory, "objects", return_value=stale):
    with patch.object(sys, "argv", ["r2_backup_inventory.py", "health"]):
        try:
            inventory.main()
        except RuntimeError as error:
            assert str(error) == "backup_older_than_36_hours"
        else:
            raise AssertionError("stale backup was accepted")

print("backup inventory: ok")
