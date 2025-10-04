# Thoteins

Thoteins is a pair of small tools to turn protein properties into consistent, human-readable portraits.

- Mapping Editor (Tk) defines how molecular properties map to human descriptors.
- Protein Portrait Prompter (browser app) produces magazine‑style text prompts for each protein.

## Layout

- apps/
  - mapping-studio/ - Launcher + Tk mapping editor (no DPG)
  - protein-portrait-prompter/ — Browser UI (no server required)
- data/ — Runtime artifacts and caches (kept out of source control by default)
  - mapping.json — Current mapping (autosaved by Mapping Studio)
  - proteins/ — Retrieved protein metadata and caches
- logs/ — App logs and PID files
- docs/ — Design notes and handoffs
- PRD.txt — Product requirements

## Run

Mapping Editor (Tk)
- Run `apps/mapping-studio/gui_launcher.pyw` (double-click on Windows).
- Click "Open Mapping Editor (Tk)".
- The editor discovers variables from `data/proteins/features.csv` (molecular) and `data/proteins/persona.csv` (human), and saves to `data/mapping.json`.

Debug launcher (Windows)
- If the GUI does not appear or you want to keep the console open, run `run_thoteins_debug.bat`. It prints errors and pauses so you can see them.

Prompter (browser)
- Open `apps/protein-portrait-prompter/index.html` directly. If ES modules are blocked on `file://`, run `python -m http.server 8080` in that folder and visit `http://localhost:8080/`.
- Drop Markdown with YAML frontmatter, CSV/JSON, or fetch by UniProt ID.
- Mapping: The Prompter will try to load `../../data/mapping.json` (or a local `apps/protein-portrait-prompter/mapping.json` if present). When serving only the Prompter folder, parent paths are not accessible; copy `data/mapping.json` next to `index.html` or serve from the repo root.
- Local writer (optional cache): Start `apps/protein-portrait-prompter/run_local_writer.bat` to enable auto-saving fetched UniProt records to `data/proteins/uniprot/<uniprot_id>.json`. The Prompter shows "Writer: connected" when it can reach `http://127.0.0.1:8787`.

Troubleshooting
- If `persona.csv` is open in Excel, rebuild writes to `persona.csv.next`. Close Excel and rebuild to finalize. See `docs/TROUBLESHOOTING.md`.

## Mapping JSON (contract)

```json
{
  "molecular": [{ "name": "mass", "type": "numeric" }],
  "human": [{ "name": "height", "type": "numeric" }],
  "mappings": [
    {
      "id": "map_1738026001",
      "type": "Numeric (multiplier)",
      "source": "mass",
      "target": "height",
      "multiplier": 0.08,
      "log": false
    },
    {
      "id": "map_1738026002",
      "type": "Categorical (bins)",
      "source": "uniprot_locations",
      "target": "background_setting",
      "bins": { "nucleus": "lab interior", "secreted": "open sky" }
    }
  ]
}
```

Notes
- Autosave: The editor writes `data/mapping.json`. There is no separate export step.
- One-to-one: Each molecular source maps to at most one human target (enforced by the app).

See also
- Architecture: `docs/ARCHITECTURE.md`
- Roadmap: `docs/ROADMAP.md`
- Prompts: `docs/PROMPTS.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`

## Caches and retrieved protein properties

Store retrieved/cached protein metadata under `data/proteins/`.

- `data/proteins/uniprot/<uniprot_id>.json` — Raw UniProt documents (cache‑first).
- `data/proteins/protein_metadata.json` — Consolidated, normalized list for the Prompter (optional).

Pros
- Reproducible runs and offline‑friendly prompts.
- Easy to blow away caches without touching source.

Cons
- Slightly more paths to manage.
- Large caches should be git‑ignored (default).

## Python

- Target the latest stable Python (3.13+). The launcher prefers `pythonw` on Windows, then `py -3w`, then `python`.

## Notes on styling

- The Prompter copies minimal color tokens locally. No cross‑project CSS links are required.
