from pathlib import Path


def test_github_actions_builds_windows_and_macos_artifacts():
    workflow = Path(".github/workflows/build.yml")

    assert workflow.exists()
    content = workflow.read_text(encoding="utf-8")
    assert "workflow_dispatch:" in content
    assert "push:" in content
    assert "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true" in content
    assert "contents: write" in content
    assert "build-windows:" in content
    assert "build-macos-x64:" in content
    assert "build-macos-arm64:" in content
    assert "windows-latest" in content
    assert "macos-15-intel" in content
    assert "macos-latest" in content
    assert "shell: pwsh" in content
    assert "shell: bash" in content
    assert 'python scripts/stamp_build_info.py "build-${{ github.run_number }}"' in content
    assert ".\\scripts\\build_windows.ps1" in content
    assert "bash scripts/build_macos.sh" in content
    assert "MACOS_DMG_NAME: OrderQuickRead-macos-x64.dmg" in content
    assert "MACOS_DMG_NAME: OrderQuickRead-macos-arm64.dmg" in content
    assert "actions/checkout@v6" in content
    assert "actions/setup-python@v6" in content
    assert "actions/upload-artifact@v7" in content
    assert "actions/download-artifact@v8" in content
    assert "actions/checkout@v4" not in content
    assert "actions/setup-python@v5" not in content
    assert "actions/upload-artifact@v4" not in content
    assert "dist/Order Quick Read" in content
    assert "dist/OrderQuickRead.exe" in content
    assert "dist/OrderQuickRead-macos-x64.dmg" in content
    assert "dist/OrderQuickRead-macos-arm64.dmg" in content
    assert "OrderQuickRead.exe#OrderQuickRead.exe" in content
    assert "OrderQuickRead-macos-x64.dmg#OrderQuickRead-macos-x64.dmg" in content
    assert "OrderQuickRead-macos-arm64.dmg#OrderQuickRead-macos-arm64.dmg" in content
    assert "build-release:" in content
    assert "needs: [build-windows, build-macos-x64, build-macos-arm64]" in content
    release_job = content.split("  build-release:", maxsplit=1)[1]
    assert "actions/checkout@v6" in release_job
    assert "GH_TOKEN: ${{ github.token }}" in content
    assert "gh release create" in content
    assert content.count("gh release create") == 1
    assert "matrix:" not in content


def test_macos_build_script_bundles_excel_parser_dependencies():
    script = Path("scripts/build_macos.sh").read_text(encoding="utf-8")

    assert "--hidden-import openpyxl" in script
    assert "--hidden-import xlrd" in script


def test_macos_build_script_creates_direct_clickable_dmg():
    script = Path("scripts/build_macos.sh").read_text(encoding="utf-8")

    assert 'APP_NAME="${MACOS_APP_NAME:-Order Quick Read}"' in script
    assert 'DMG_NAME="${MACOS_DMG_NAME:-OrderQuickRead.dmg}"' in script
    assert 'APP_PATH="dist/${APP_NAME}.app"' in script
    assert 'DMG_PATH="dist/${DMG_NAME}"' in script
    assert "--icon assets/app_icon.icns" in script
    assert "hdiutil create" in script
    assert '-format UDZO "$DMG_PATH"' in script
