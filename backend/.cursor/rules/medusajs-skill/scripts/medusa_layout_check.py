#!/usr/bin/env python3
"""
Scan a directory for common Medusa v2 backend layout markers.

Usage:
  python3 medusa_layout_check.py [ROOT]

Exit codes:
  0 — Looks like a Medusa backend (core markers found)
  1 — Missing strong markers or unreadable path
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def analyze(root: Path) -> dict:
    """Return structured findings for ROOT."""
    findings: dict = {
        "root": str(root.resolve()),
        "exists": root.is_dir(),
        "medusa_config": False,
        "package_json": False,
        "medusa_deps": [],
        "has_src_api": False,
        "has_src_workflows": False,
        "has_src_modules": False,
        "has_src_subscribers": False,
        "has_src_jobs": False,
    }

    if not root.is_dir():
        findings["error"] = "not a directory"
        return findings

    for name in ("medusa-config.ts", "medusa-config.js", "medusa-config.mjs"):
        if (root / name).is_file():
            findings["medusa_config"] = True
            break

    pkg = root / "package.json"
    if pkg.is_file():
        findings["package_json"] = True
        data = _read_json(pkg)
        if isinstance(data, dict):
            deps = data.get("dependencies") or {}
            dev = data.get("devDependencies") or {}
            for k in sorted(set(deps) | set(dev)):
                if k.startswith("@medusajs/") or k == "medusa-cli":
                    findings["medusa_deps"].append(k)

    for key, sub in (
        ("has_src_api", "src/api"),
        ("has_src_workflows", "src/workflows"),
        ("has_src_modules", "src/modules"),
        ("has_src_subscribers", "src/subscribers"),
        ("has_src_jobs", "src/jobs"),
    ):
        findings[key] = (root / sub).is_dir()

    score = 0
    if findings["medusa_config"]:
        score += 2
    if findings["medusa_deps"]:
        score += 2
    if findings["has_src_api"]:
        score += 1
    findings["confidence_score"] = score
    findings["likely_medusa_backend"] = score >= 3 and bool(findings["medusa_deps"])
    return findings


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    result = analyze(root)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("likely_medusa_backend") else 1)


if __name__ == "__main__":
    main()
