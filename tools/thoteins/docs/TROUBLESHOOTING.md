# Troubleshooting

## No GUI when launching `.bat`
- Cause: `pythonw.exe` hides errors (e.g., missing Tk).
- Fix: Run `Thoteins/run_thoteins_debug.bat` to keep the console open and see traceback. Ensure Python install includes Tcl/Tk.

## Persona rebuild fails with `PermissionError` on Windows
- Cause: `persona.csv` is open in Excel or another app.
- Behavior: The rebuild now writes to `persona.csv.next` and logs a warning.
- Fix: Close the app holding the file and rebuild again. You can manually rename `persona.csv.next` if needed.

## Categorical values are blank
- Cause: Mapping bins do not match discovered tokens yet.
- Fix: In the Mapping Editor (Tk), select the mapping, fill bins for the listed tokens, then Rebuild Persona.
- Tip: Click “Rebuild Database” and then “Reload CSVs” to refresh token discovery before editing bins.

## Prompter cannot reach mapping or writer
- Mapping: When serving only the Prompter folder, parent paths are not accessible. Copy `data/mapping.json` next to `index.html` or serve from repo root.
- Writer: Ensure `run_thoteins.bat` started the Local Writer. The Prompter’s pill should read “Writer: connected”.

