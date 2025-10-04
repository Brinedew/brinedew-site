@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
set "BASE=%~dp0"
pushd "%BASE%" >nul 2>&1

rem Force debug mode so the main launcher uses console python and pauses on exit
set "THOTEINS_DEBUG=1"
echo [debug] THOTEINS_DEBUG=1

rem Delegate to the main launcher with an explicit flag as well
call "%BASE%run_thoteins.bat" debug
set "RC=%ERRORLEVEL%"
echo.
echo Launcher exit code: %RC%
echo Log: %BASE%logs\launcher_start.log
echo.
pause

popd >nul 2>&1
endlocal

