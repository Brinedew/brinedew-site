# Firefox PDF end-to-end proof

This suite drives the installed release Firefox with Selenium and a disposable profile. It installs the unsigned Firefox package temporarily, serves a real paper through a loopback conformance server, uses the real popup toggle, captures screenshots, and checks request counts during native handback.

The conformance cases cover ordinary GET, a single-use GET that returns 410 on replay, a POST response, a partial-range response that must remain native, and Off handoff to a fully rendered Firefox-native PDF page. Evidence is written under `iconoplasm-extension/artifacts/firefox-pdf-e2e/`.

It does not disable extension signing, reuse the daily Firefox profile, install a proxy, or weaken browser security settings.

Run from the Website repository after packaging Firefox:

```powershell
pnpm run package:iconoplasm-firefox
& '.\iconoplasm-extension\e2e\Run-FirefoxPdfE2E.ps1'
```
