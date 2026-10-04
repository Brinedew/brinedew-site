# Firefox PDF end-to-end proof

This suite drives the installed Firefox browser with Selenium and a disposable profile. It installs the unsigned Firefox validation package temporarily, serves a real paper through a loopback conformance server, uses the real popup toggle, captures screenshots, and checks request counts during native handback.

The conformance cases cover ordinary GET, a single-use GET that returns 410 on replay, a POST response, a partial-range response that must remain native, and Off handoff to a fully rendered Firefox-native PDF page. The local-file case opens a real `file:` PDF, verifies the private File API handoff, renders gene decorations, hovers a real anchor, requires a decoded portrait inside the visible hover card, and hands the selected bytes to Firefox's native PDF viewer without reopening or uploading the path. Evidence is written under `iconoplasm-extension/artifacts/firefox-pdf-e2e/`.

It does not disable extension signing, reuse the daily Firefox profile, install a proxy, or weaken browser security settings.

`--firefox-binary` is optional (Selenium Manager finds Firefox otherwise), and `--paper` defaults to the bundled fixture. Run from the Website repository. The package command writes the exact input used
by the suite to
`iconoplasm-extension/dist/validation/firefox/iconoplasm-firefox-validation.zip`:

```powershell
pnpm run package:iconoplasm-firefox
& '.\iconoplasm-extension\e2e\Run-FirefoxPdfE2E.ps1'
```

## CI

`.github/workflows/firefox-pdf-e2e.yml` runs this suite on ubuntu-latest under `xvfb-run` for pull requests that touch PDF-related extension files, on manual dispatch, and as a required job of `prepare-iconoplasm-release.yml`, so a Firefox PDF routing regression cannot reach a store release. Screenshots, request ledger and geckodriver log are uploaded as the `firefox-pdf-e2e` artifact.

## Fixture attribution

`tests/PLOS_BRCA1_BRCA2_TP53.pdf` is Carraro DM, et al. (2013) "Comprehensive Analysis of BRCA1, BRCA2 and TP53 Germline Mutation and Tumor Characterization: A Portrait of Early-Onset Breast Cancer in Brazil", PLOS ONE 8(3): e57581, https://doi.org/10.1371/journal.pone.0057581. It is licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) and is used unmodified as the test paper.
