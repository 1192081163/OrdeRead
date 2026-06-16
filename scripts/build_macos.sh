#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${MACOS_APP_NAME:-Order Quick Read}"
DMG_NAME="${MACOS_DMG_NAME:-OrderQuickRead.dmg}"

python3 -m PyInstaller \
  --name "$APP_NAME" \
  --windowed \
  --icon assets/app_icon.icns \
  --clean \
  --noconfirm \
  --hidden-import openpyxl \
  --hidden-import xlrd \
  src/email_order_reader/app.py

APP_PATH="dist/${APP_NAME}.app"
DMG_ROOT="dist/dmg-root"
DMG_PATH="dist/${DMG_NAME}"

rm -rf "$DMG_ROOT" "$DMG_PATH"
mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/${APP_NAME}.app"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO "$DMG_PATH"
