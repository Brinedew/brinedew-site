@echo on
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
rem Permanent console runner for the batch builder; always stays open with PAUSE at the end.
set "HERE=%~dp0"
cd /d "%HERE%"

echo [console] Thoteins batch builder (console mode)
echo If this window still closes quickly, run the PowerShell version:
echo    Thoteins\scripts\run_build_batch_pwsh.ps1
echo Or run from PowerShell:  ^& Thoteins\scripts\run_build_batch_console.bat

rem Log file for post-mortem if the window still closes unexpectedly
set "LOG=%HERE%..\logs\batch_builder.log"
if not exist "%HERE%..\logs" mkdir "%HERE%..\logs" 1>nul 2>nul
echo ==== %DATE% %TIME% ==== >>"%LOG%"
echo PWD: %CD% >>"%LOG%"
echo ARG1: %~1 >>"%LOG%"
echo WHERE py: >>"%LOG%"
where py 1>>"%LOG%" 2>&1
echo WHERE python: >>"%LOG%"
where python 1>>"%LOG%" 2>&1

rem Resolve Python (prefer py -3, else first python.exe on PATH)
set "PY_EXE="
set "PY_ARGS=-3"
where py >nul 2>&1 && set "PY_EXE=py"
if not defined PY_EXE (
  for /f "usebackq delims=" %%P in (`where python 2^>nul`) do if not defined PY_EXE set "PY_EXE=%%~fP"
)
if not defined PY_EXE (
  echo [error] Python 3 not found. Please install from https://www.python.org/
  echo [error] Python 3 not found. >>"%LOG%"
  echo.
  pause
  goto :eof
)
echo PY_EXE: %PY_EXE% >>"%LOG%"
echo PY_ARGS: %PY_ARGS% >>"%LOG%"

set "OUT=..\data\proteins\batch_top100.csv"
set "LIMIT=100"
set "TAXON=9606"

if "%~1"=="" (
  echo [info] Online mode: fetching top %LIMIT% human (Swiss-Prot) via UniProt
  echo        Output: %OUT%
  echo MODE: online >>"%LOG%"
  if /i "%PY_EXE%"=="py" (
    echo CMD: py %PY_ARGS% -u build_protein_batch.py --limit %LIMIT% --taxon %TAXON% --include-mapped --out "%OUT%" >>"%LOG%"
    py %PY_ARGS% -u build_protein_batch.py --limit %LIMIT% --taxon %TAXON% --include-mapped --out "%OUT%" 1>>"%LOG%" 2>&1
  ) else (
    echo CMD: "%PY_EXE%" -u build_protein_batch.py --limit %LIMIT% --taxon %TAXON% --include-mapped --out "%OUT%" >>"%LOG%"
    "%PY_EXE%" -u build_protein_batch.py --limit %LIMIT% --taxon %TAXON% --include-mapped --out "%OUT%" 1>>"%LOG%" 2>&1
  )
) else (
  echo [info] Offline mode: converting downloaded SPARQL CSV
  echo        Source: %~1
  echo        Output: %OUT%
  echo MODE: offline >>"%LOG%"
  if /i "%PY_EXE%"=="py" (
    echo CMD: py %PY_ARGS% -u build_protein_batch.py --from-sparql-csv "%~1" --out "%OUT%" --ids-only >>"%LOG%"
    py %PY_ARGS% -u build_protein_batch.py --from-sparql-csv "%~1" --out "%OUT%" --ids-only 1>>"%LOG%" 2>&1
  ) else (
    echo CMD: "%PY_EXE%" -u build_protein_batch.py --from-sparql-csv "%~1" --out "%OUT%" --ids-only >>"%LOG%"
    "%PY_EXE%" -u build_protein_batch.py --from-sparql-csv "%~1" --out "%OUT%" --ids-only 1>>"%LOG%" 2>&1
  )
)

echo.
echo Exit code: %ERRORLEVEL%
echo Exit code: %ERRORLEVEL% >>"%LOG%"
echo CSV path (if success): %CD%\%OUT%
echo CSV: %CD%\%OUT% >>"%LOG%"
echo.
pause

endlocal
