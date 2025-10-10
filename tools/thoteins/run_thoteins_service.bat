@echo off
rem NSSM-friendly wrapper for Thoteins Debug
rem This runs the GUI launcher directly without pause/console interaction

setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
set "BASE=%~dp0"
pushd "%BASE%" >nul 2>&1

rem Find Python
set "PY_EXE="
where python >nul 2>&1
if %ERRORLEVEL%==0 (
  for /f "usebackq delims=" %%P in (`where python`) do (
    if not defined PY_EXE set "PY_EXE=%%~fP"
  )
)

if not defined PY_EXE (
  echo ERROR: Python not found
  exit /b 1
)

rem Run the GUI launcher
set "LAUNCH=apps\mapping-studio\gui_launcher.pyw"
if not exist "%LAUNCH%" (
  echo ERROR: Missing %LAUNCH%
  exit /b 1
)

rem Run with console python for service (captures output)
"%PY_EXE%" "%LAUNCH%"
set "RC=%ERRORLEVEL%"

popd >nul 2>&1
endlocal
exit /b %RC%
