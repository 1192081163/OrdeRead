# Email Order Reader

Minimal desktop app for scanning recent IMAP email attachments and showing order deadlines.

## Behavior

- Scans the inbox for email from the latest 24 hours.
- Reads Excel attachments with `.xlsx`, `.xlsm`, or `.xls` extensions.
- Shows only two columns: `订单号` and `截至时间`.
- Collapses the mailbox settings after the required fields are filled.
- Does not save mailbox credentials.
- Does not save scan history.

## Development

Use Python 3.11 or newer.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python -m pytest
```

## Run

```bash
email-order-reader
```

## Package

macOS:

```bash
bash scripts/build_macos.sh
```

Windows PowerShell:

```powershell
.\scripts\build_windows.ps1
```

Unsigned internal builds may show Windows SmartScreen or macOS Gatekeeper warnings.
