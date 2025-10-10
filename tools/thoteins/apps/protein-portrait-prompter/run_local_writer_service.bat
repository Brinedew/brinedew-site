@echo off
rem NSSM-friendly wrapper for Thoteins Writer

setlocal
set "BASE=%~dp0"
pushd "%BASE%" >nul 2>&1

rem Find Python
where python >nul 2>&1 && (set "PY=python") || (where py >nul 2>&1 && (set "PY=py -3"))
if not defined PY (
  echo ERROR: Python not found
  exit /b 1
)

rem Run the writer server
%PY% -u local_writer.py
set "RC=%ERRORLEVEL%"

popd >nul 2>&1
endlocal
exit /b %RC%
