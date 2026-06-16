$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$VenvDir = Join-Path $ProjectRoot ".venv-windows"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv $VenvDir
  } else {
    & python -m venv $VenvDir
  }

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PythonExe)) {
    throw "Failed to create Python virtual environment. Install Python 3.11+ from python.org, enable Add python.exe to PATH, then rerun this script."
  }
}

$PythonExe = (Resolve-Path $PythonExe).Path

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -e ".[dev]"

$env:QT_QPA_PLATFORM = "offscreen"
try {
  & $PythonExe -m pytest -q
} finally {
  Remove-Item Env:\QT_QPA_PLATFORM -ErrorAction SilentlyContinue
}

& $PythonExe -m PyInstaller `
  --name "Email Order Reader" `
  --windowed `
  --clean `
  --noconfirm `
  --hidden-import openpyxl `
  --hidden-import xlrd `
  src/email_order_reader/app.py

& $PythonExe -m PyInstaller `
  --name "EmailOrderReader" `
  --onefile `
  --windowed `
  --clean `
  --noconfirm `
  --hidden-import openpyxl `
  --hidden-import xlrd `
  src/email_order_reader/app.py

Write-Host "Portable folder build complete: dist\Email Order Reader\Email Order Reader.exe"
Write-Host "Direct executable build complete: dist\EmailOrderReader.exe"
