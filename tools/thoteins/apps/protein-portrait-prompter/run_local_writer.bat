@echo off
setlocal

set "BASE=%~dp0"
pushd "%BASE%" >nul 2>&1

where py >nul 2>&1 && (set "PY=py -3") || (where python >nul 2>&1 && (set "PY=python"))
if not defined PY (
  echo Python was not found on PATH.
  echo Install Python 3 and re-run, or set PATH.
  goto :eof
)

echo Starting Thoteins local writer on http://127.0.0.1:8787
%PY% -u local_writer.py

popd >nul 2>&1
endlocal
