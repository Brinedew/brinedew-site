# check-isp-dns-self-heal.cmd
@echo off
REM Re-run the four Vietnam ISP resolver check.
REM If the four resolvers all return NOERROR + A record, the bug self-healed.
REM If any return NXDOMAIN or SERVFAIL, the bug is still active.
"D:\Coding\Iconoplasm\.venv\Scripts\python.exe" "D:\Coding\Iconoplasm\artifacts\image-bug-diagnosis-2026-06-26\probe_isp_resolvers.py"
pause
