@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
set "BASE=%~dp0"
pushd "%BASE%" >nul 2>&1

rem Logs
set "LOGDIR=logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set "STARTLOG=%LOGDIR%\launcher_start.log"
>>"%STARTLOG%" echo ==== Thoteins start %DATE% %TIME% ====

rem Args: debug mode keeps console open and uses console python
set "DEBUG=0"
if /i "%~1"=="debug" set "DEBUG=1"
if /i "%~1"=="--debug" set "DEBUG=1"
if /i "%~1"=="/debug" set "DEBUG=1"
if "%THOTEINS_DEBUG%"=="1" set "DEBUG=1"
if %DEBUG%==1 ( >>"%STARTLOG%" echo [info] Debug mode enabled )

rem Resolve best Python (prefer concrete pythonw.exe/python.exe path; fallback to py -3)
set "PY_EXE="
set "PY_ARGS="

rem Try py -0p (lists all registered Pythons with absolute paths)
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  for /f "usebackq delims=" %%L in (`py -0p 2^>nul`) do (
    set "LINE=%%L"
    rem Case 1: line is a direct path
    if exist "!LINE!" (
      call :_consider_python "!LINE!"
    ) else (
      rem Case 2: " -3.13-64: C:\\Python313\\python.exe" -> take substring after first ':'
      for /f "tokens=1,* delims=:" %%A in ("!LINE!") do (
        set "CAND=%%B"
      )
      for /f "tokens=* delims= " %%X in ("!CAND!") do set "CAND=%%~X"
      if defined CAND if exist "!CAND!" call :_consider_python "!CAND!"
    )
  )
)

rem Fallbacks if nothing chosen yet
if not defined PY_EXE (
  where pythonw >nul 2>&1 && for /f "usebackq delims=" %%P in (`where pythonw`) do ( if not defined PY_EXE set "PY_EXE=%%~fP" )
)
if not defined PY_EXE (
  where python >nul 2>&1 && for /f "usebackq delims=" %%P in (`where python`) do ( if not defined PY_EXE set "PY_EXE=%%~fP" )
)
if not defined PY_EXE (
  where py >nul 2>&1 && for /f "usebackq delims=" %%P in (`where py`) do ( if not defined PY_EXE set "PY_EXE=%%~fP" & set "PY_ARGS=-3" )
)

if not defined PY_EXE (
  >>"%STARTLOG%" echo [error] No Python found on PATH.
  echo Python 3 was not found. Please install Python 3 and re-run.
  pause
  goto :eof
)

rem Prefer pythonw.exe if sibling exists
set "PY_CONSOLE=!PY_EXE!"
if /i "!PY_EXE:~-10!"=="python.exe" (
  set "PYW=!PY_EXE:python.exe=pythonw.exe!"
  if exist "!PYW!" set "PY_EXE=!PYW!"
)
if /i "!PY_EXE:~-11!"=="pythonw.exe" (
  set "PY_CONSOLE=!PY_EXE:pythonw.exe=python.exe!"
)

>>"%STARTLOG%" echo Using Python (gui): "!PY_EXE!" !PY_ARGS!
>>"%STARTLOG%" echo Using Python (console): "!PY_CONSOLE!"

set "LAUNCH=apps\mapping-studio\gui_launcher.pyw"
if not exist "%LAUNCH%" (
  >>"%STARTLOG%" echo [error] Missing %LAUNCH% in %CD%
  echo Could not find %LAUNCH% under %CD%.
  pause
  goto :eof
)

rem Preflight: verify tkinter is available
>>"%STARTLOG%" echo Preflight: checking tkinter with console python
"!PY_CONSOLE!" -c "import tkinter as tk; print('tk ok')" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  >>"%STARTLOG%" echo [error] tkinter not available for "!PY_CONSOLE!". Forcing console run.
  set "DEBUG=1"
)

if %DEBUG%==1 (
  echo [debug] Running with console and keeping window open...
  >>"%STARTLOG%" echo Debug run: "!PY_CONSOLE!" !PY_ARGS! "%LAUNCH%"
  "!PY_CONSOLE!" !PY_ARGS! "%LAUNCH%"
  echo.
  echo Exit code: %ERRORLEVEL%
  echo Logs: %STARTLOG%
  pause
) else (
  rem Compose and start (detached). If start fails, run directly with pause.
  set "CMDLINE=\"!PY_EXE!\" !PY_ARGS! \"%LAUNCH%\""
  >>"%STARTLOG%" echo Command: !CMDLINE!
  start "Thoteins" "!PY_EXE!" !PY_ARGS! "%LAUNCH%"
  if %ERRORLEVEL% NEQ 0 (
    >>"%STARTLOG%" echo [warn] start returned %ERRORLEVEL%, falling back to direct console run
    "!PY_CONSOLE!" !PY_ARGS! "%LAUNCH%"
    echo.
    echo Exit code: %ERRORLEVEL%
    echo Logs: %STARTLOG%
    pause
  )
)

popd >nul 2>&1
endlocal
goto :eof

:_consider_python
rem %1 is a full path to python.exe discovered from py -0p
set "CAND=%~1"
set "CANDW=%CAND:python.exe=pythonw.exe%"
if exist "%CANDW%" (
  if not defined PY_EXE set "PY_EXE=%CANDW%"
) else (
  if not defined PY_EXE set "PY_EXE=%CAND%"
)
goto :eof
