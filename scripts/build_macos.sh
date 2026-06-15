#!/usr/bin/env bash
set -euo pipefail

python3 -m PyInstaller \
  --name "Email Order Reader" \
  --windowed \
  --clean \
  --noconfirm \
  src/email_order_reader/app.py
