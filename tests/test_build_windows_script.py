from pathlib import Path


def test_windows_build_script_executes_venv_python_by_absolute_path():
    script = Path("scripts/build_windows.ps1").read_text(encoding="utf-8")

    assert "Resolve-Path" in script
    assert "$PythonExe = (Resolve-Path $PythonExe).Path" in script


def test_windows_build_script_reports_failed_venv_creation_before_resolving_python():
    script = Path("scripts/build_windows.ps1").read_text(encoding="utf-8")

    failure_check = 'if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PythonExe))'
    resolve_python = "$PythonExe = (Resolve-Path $PythonExe).Path"

    assert failure_check in script
    assert script.index(failure_check) < script.index(resolve_python)


def test_windows_build_script_creates_direct_clickable_exe():
    script = Path("scripts/build_windows.ps1").read_text(encoding="utf-8")

    assert '--name "EmailOrderReader"' in script
    assert "--onefile" in script
    assert "dist\\EmailOrderReader.exe" in script
