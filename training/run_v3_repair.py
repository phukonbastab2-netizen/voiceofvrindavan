"""Generate, validate, sanity-check, and run the V3 repair fine-tune."""
import json
import os
import subprocess
import sys
import traceback
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATUS = ROOT / "runs" / "talker-v3-orchestration.json"


def save(status, **details):
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps({"status": status, **details}, indent=2), encoding="utf-8")


def run(*args):
    print("Running:", " ".join(map(str, args)), flush=True)
    subprocess.run([sys.executable, *map(str, args)], cwd=ROOT, check=True)


try:
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    with zipfile.ZipFile(ROOT / "talker-v3-repair.zip") as archive:
        archive.extractall(ROOT)
    run("build_talker_v3.py", "--output-dir", "data-v3")

    sys.path.insert(0, str(ROOT))
    from prepare_data import read_rows

    counts = {split: len(read_rows(ROOT / "data-v3" / f"{split}.jsonl")) for split in ("train", "validation", "test")}
    audit = json.loads((ROOT / "data-v3" / "audit.json").read_text(encoding="utf-8"))
    if counts != {"train": 1200, "validation": 160, "test": 160}:
        raise RuntimeError(f"Unexpected row counts: {counts}")
    if audit["issues"] or audit["checks"]["exact_cross_split_duplicates"] != 0:
        raise RuntimeError(f"Dataset audit failed: {audit}")
    save("dataset_validated", rows=counts)

    run("train.py", "--config", "config-v3.json", "--mode", "sanity", "--output-dir", "runs/talker-v3-sanity")
    sanity = json.loads((ROOT / "runs" / "talker-v3-sanity" / "status.json").read_text())
    if sanity.get("status") != "completed" or not sanity.get("adapter_updated"):
        raise RuntimeError(f"Sanity training failed validation: {sanity}")
    save("sanity_completed", rows=counts, sanity=sanity)

    run("train.py", "--config", "config-v3.json", "--mode", "full", "--output-dir", "runs/talker-v3-full")
    full = json.loads((ROOT / "runs" / "talker-v3-full" / "status.json").read_text())
    if full.get("status") != "completed" or not full.get("adapter_updated"):
        raise RuntimeError(f"Full training failed validation: {full}")
    save("completed", rows=counts, sanity=sanity, full=full)
    print("V3_REPAIR_COMPLETED", flush=True)
except Exception as exc:
    save("failed", error=str(exc), traceback=traceback.format_exc())
    raise

