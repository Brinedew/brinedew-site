@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
rem Prefer system 'py' launcher; fall back to python on PATH
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%SCRIPT_DIR%clean_tags.py"
) else (
  python "%SCRIPT_DIR%clean_tags.py"
)
echo.
echo Done. Press any key to close...
pause >nul