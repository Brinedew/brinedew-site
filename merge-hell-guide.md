# Obsidian / Git — Conflict‑Recovery Guide

**Purpose**  Provide a deterministic procedure for AI‑driven editors (and humans) to resolve merge conflicts and maintain repository integrity. Keep this document unchanged unless you are explicitly instructed to revise it.

---

## 1  Background  (2025‑05‑30 incident)

* Concurrent edits to `.obsidian/workspace.json` created a merge conflict.
* Forced resets exposed an orphaned Git submodule (`decap-proxy`) and deleted built pages, causing a site outage.
* Continuous‑integration (CI) builds failed because MkDocs ran in strict mode and reported unresolved links.

Permanent mitigations now in place:

| Area                        | Commit               | Effect                                                                                     |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| Ignore Obsidian layout file | `xxxxxxx`            | `.obsidian/workspace.json` added to `.gitignore` to prevent further conflicts.             |
| Submodule removed           | `3cdfbcf`            | `decap-proxy` converted to a regular folder; CI no longer fails for missing submodule URL. |
| Modern Pages deployment     | current `deploy.yml` | Uses `actions/deploy-pages` artifact pipeline — no `gh-pages` branch required.             |

---

## 2  Standard workflow (AI editor)

1. **Pull** `origin/main`.
2. Perform edits in the `docs/` directory or other tracked files.
3. **Commit** with a clear message.
4. **Push** to `main`. CI will build and deploy automatically.

> Do not commit `.obsidian/workspace.json`. Git ignores this file by design.

---

## 3  Merge‑Conflict Recovery (clean, scriptable)

```bash
# Abort any merge in progress
git merge --abort || true

# Ensure local tree matches remote main
git fetch origin
git reset --hard origin/main

# Retry your edits, commit, push
```

The command sequence above is idempotent and safe. It discards only uncommitted local changes.

---

## 4  Files and settings to avoid modifying

| Item                                                                | Reason                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.git/` internals                                                   | Manual edits risk repository corruption.                                         |
| `decap-proxy/.git`                                                  | Must remain removed; re‑introducing it re‑creates the submodule error.           |
| Permissions in `.github/workflows/deploy.yml` (`pages`, `id-token`) | Required for GitHub Pages OIDC authentication.                                   |
| `strict: true` in `mkdocs.yml`                                      | Disabling strict mode hides link errors; change only with project lead approval. |
| Force‑push to `main`                                                | Allowed only when reverting to a vetted commit hash.                             |

---

## 5  Reference commands

```bash
# List commits touching a specific file
git log --oneline -- docs/index.md

# Detect stray submodules (mode 160000)
git ls-files -s | findstr 160000

# Cherry‑pick the decap‑proxy fix onto another commit
git cherry-pick 3cdfbcf
```

---

**Document version:** 2025‑05‑30 v2 (public‑facing, formal)
