# 订单快读

Order Quick Read is a minimal desktop app for scanning IMAP email attachments and showing order deadlines.

## Behavior

- Scans all email in the inbox.
- Uses Enterprise WeChat/Tencent Exmail IMAP defaults internally: `imap.exmail.qq.com:993`.
- Reads Excel attachments with `.xlsx`, `.xlsm`, or `.xls` extensions.
- Shows only two columns: `订单号` and `截至时间`.
- Sorts orders by deadline with the nearest deadline first.
- Auto-refreshes every 30 seconds after mailbox settings are saved.
- Shows a desktop tray notification and highlights rows when new or updated orders are found.
- Shows only email address and authorization code in the mailbox settings area, then collapses it after both are filled.
- Saves mailbox email address and authorization code locally so they are restored on the next launch.
- Saves a local lightweight order cache for faster refreshes; it does not store email bodies or attachment files.

Settings are stored in a local JSON file:

```text
Windows: %APPDATA%\EmailOrderReader\settings.json
macOS/Linux: ~/.email-order-reader/settings.json
```

On Windows, an older config at this path is copied into `%APPDATA%` automatically if needed:

```text
~/.email-order-reader/settings.json
```

The authorization code is stored in this local file, not in the system keychain.

The order cache is stored next to the settings file as `order_cache.json`.

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

GitHub Actions:

Push the project to GitHub, then open Releases for direct downloads:

```text
OrderQuickRead.exe
OrderQuickRead-macos-x64.dmg
OrderQuickRead-macos-arm64.dmg
```

On Windows, download `OrderQuickRead.exe` and double-click to run.

On macOS Intel, download `OrderQuickRead-macos-x64.dmg`, open it, then open `Order Quick Read.app`.

On macOS Apple Silicon, download `OrderQuickRead-macos-arm64.dmg`, open it, then open `Order Quick Read.app`.

Unsigned internal macOS builds may be blocked by Gatekeeper on first open. If macOS blocks the app because it is not notarized, right-click `Order Quick Read.app`, choose `Open`, then confirm.

GitHub Actions also uploads these build artifacts:

```text
order-quick-read-windows
OrderQuickRead.exe
order-quick-read-macos-x64
OrderQuickRead-macos-x64.dmg
order-quick-read-macos-arm64
OrderQuickRead-macos-arm64.dmg
```

macOS:

```bash
bash scripts/build_macos.sh
```

Windows PowerShell:

```powershell
.\scripts\build_windows.ps1
```

The Windows build output is:

```text
dist\Order Quick Read\Order Quick Read.exe
```

The macOS direct-download output is:

```text
dist/OrderQuickRead.dmg
```

Unsigned internal builds may show Windows SmartScreen or macOS Gatekeeper warnings.
