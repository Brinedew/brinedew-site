@echo off
setlocal
REM Re-run the four Vietnam ISP resolver check.
REM If the four resolvers all return NOERROR + A record, the bug self-healed.
REM If any return NXDOMAIN or SERVFAIL, the bug is still active.
REM Pass --no-pause when invoking this wrapper from automation.
where uv >nul 2>&1
if errorlevel 1 (
  echo [dns-check] uv is required. Install it from https://docs.astral.sh/uv/ 1>&2
  exit /b 1
)

uv run --managed-python --script "%~dp0probe_isp_resolvers_for_iconoplasm_cdn.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
if /I not "%~1"=="--no-pause" pause
exit /b %EXIT_CODE%
