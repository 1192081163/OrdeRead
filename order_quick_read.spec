# -*- mode: python ; coding: utf-8 -*-

from __future__ import annotations

import os
from pathlib import Path


ROOT = Path.cwd()
APP_NAME = os.environ.get("MACOS_APP_NAME", "Order Quick Read")


a = Analysis(
    ["src/email_order_reader/app.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[("assets", "assets")],
    hiddenimports=[
        "openpyxl",
        "xlrd",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "unittest",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name=APP_NAME,
)
app = BUNDLE(
    coll,
    name=f"{APP_NAME}.app",
    icon=str(ROOT / "assets" / "app_icon.icns"),
    bundle_identifier="com.orderquickread.desktop",
    info_plist={
        "CFBundleDisplayName": APP_NAME,
        "CFBundleName": APP_NAME,
        "NSHighResolutionCapable": True,
    },
)
