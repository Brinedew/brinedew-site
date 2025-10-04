# Roadmap

This is a living plan for the next phases. It focuses on small, verifiable steps that keep user flows smooth and the system reliable.

## Near-term (now → next week)
- Mapping: Add a “Bin coverage” helper that lists unmapped tokens per categorical source so gaps are obvious before rebuilds.
- Rebuild UX: Show a transient toast with the final line and exit code after a rebuild, in addition to streaming logs.
- Robust writes: If `persona.csv.next` exists, detect it at launcher start and offer a one-click finalize once the target file is unlocked.


## Recently Completed
- **Mapping logic consolidation**: Eliminated dual implementations (Python + JavaScript), frontend now calls `/apply-mapping` API
- **Legacy code cleanup**: Removed ~400 lines of commented code from `index.html`
- **API-first architecture**: Prompter is now thin presentation layer, all business logic server-side

## Medium-term (2–4 weeks)
- Tests: Add unit tests for `_apply_mapping` (numeric/log and categorical) and for CSV rebuilds on a tiny fixture set.
- Token discovery: Allow per-source custom splitters (default `; | /`) to match quirky datasets without code changes.

## Longer-term
- Data enrichment: Optional fetchers for STRING/HPA/GnomAD with caching and rate‑limit friendly batching.
- Image pipeline: Optional script to call image APIs and place outputs.
- Coverage analytics: Simple report of how many proteins get each persona value (e.g., background settings distribution).

