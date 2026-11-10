#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""仓库快捷入口：转发到 id-photo-cutout skill 脚本。"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

# tools/cli -> 仓库根目录
_SCRIPT = (
    Path(__file__).resolve().parent.parent.parent
    / ".cursor"
    / "skills"
    / "id-photo-cutout"
    / "scripts"
    / "id_photo_cutout.py"
)

if not _SCRIPT.is_file():
    print(f"找不到 skill 脚本: {_SCRIPT}", file=sys.stderr)
    raise SystemExit(1)

runpy.run_path(str(_SCRIPT), run_name="__main__")
