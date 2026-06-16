#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${MACOS_APP_NAME:-Order Quick Read}"
DMG_NAME="${MACOS_DMG_NAME:-OrderQuickRead.dmg}"
export MACOS_APP_NAME="$APP_NAME"

APP_PATH="dist/${APP_NAME}.app"
DMG_ROOT="dist/dmg-root"
DMG_PATH="dist/${DMG_NAME}"

rm -rf build "$APP_PATH" "$DMG_ROOT" "$DMG_PATH"
python3 -m PyInstaller --clean --noconfirm order_quick_read.spec

mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/${APP_NAME}.app"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO "$DMG_PATH"
