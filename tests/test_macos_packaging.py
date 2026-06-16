from __future__ import annotations

from pathlib import Path


def test_macos_build_uses_pyinstaller_spec_with_stable_bundle_metadata():
    spec_path = Path("order_quick_read.spec")
    build_script = Path("scripts/build_macos.sh").read_text(encoding="utf-8")

    assert spec_path.is_file()
    assert "order_quick_read.spec" in build_script

    spec_text = spec_path.read_text(encoding="utf-8")
    assert 'bundle_identifier="com.orderquickread.desktop"' in spec_text
    assert '"CFBundleDisplayName": APP_NAME' in spec_text
    assert '"CFBundleName": APP_NAME' in spec_text
    assert '"openpyxl"' in spec_text
    assert '"xlrd"' in spec_text
