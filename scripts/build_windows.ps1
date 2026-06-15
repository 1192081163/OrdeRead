$ErrorActionPreference = "Stop"

python -m PyInstaller `
  --name "Email Order Reader" `
  --windowed `
  --clean `
  --noconfirm `
  src/email_order_reader/app.py
