from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.selenium_manager import SeleniumManager

from pdf_conformance_server import PdfConformanceServer

DEFAULT_PAPER = Path(__file__).resolve().parent / "PLOS_BRCA1_BRCA2_TP53.pdf"


def pytest_addoption(parser: pytest.Parser) -> None:
    # Optional: without it Selenium Manager locates (or downloads) Firefox.
    parser.addoption("--firefox-binary", default=None)
    parser.addoption("--xpi", required=True)
    # Carraro et al. 2013, PLOS ONE, CC BY 4.0 (see e2e/README.md).
    parser.addoption("--paper", default=str(DEFAULT_PAPER))
    parser.addoption("--artifacts", required=True)


@pytest.fixture(scope="session")
def artifacts(request: pytest.FixtureRequest) -> Path:
    path = Path(request.config.getoption("--artifacts")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture(scope="session")
def pdf_server(request: pytest.FixtureRequest, artifacts: Path):
    paper = Path(request.config.getoption("--paper")).resolve()
    if not paper.is_file():
        raise FileNotFoundError(paper)
    with PdfConformanceServer(paper) as server:
        yield server
        server.write_ledger(artifacts / "requests.ndjson")


@pytest.fixture(scope="session")
def firefox(request: pytest.FixtureRequest, artifacts: Path):
    binary_option = request.config.getoption("--firefox-binary")
    binary = Path(binary_option).resolve() if binary_option else None
    xpi = Path(request.config.getoption("--xpi")).resolve()
    options = Options()
    if binary:
        options.binary_location = str(binary)
    options.set_preference("browser.download.useDownloadDir", True)
    options.set_preference("browser.download.folderList", 2)
    options.set_preference("browser.download.dir", str(artifacts / "downloads"))
    options.set_preference("browser.download.alwaysOpenPanel", False)
    manager_args = ["--browser", "firefox", "--skip-driver-in-path"]
    if binary:
        manager_args += ["--browser-path", str(binary)]
    driver_path = SeleniumManager().binary_paths(manager_args)["driver_path"]
    service = Service(
        executable_path=driver_path,
        log_output=str(artifacts / "geckodriver.log"),
        # geckodriver 0.37+ owns this explicit browser-UI testing opt-in;
        # passing Firefox's old capability is intentionally rejected.
        service_args=["--allow-system-access", "--log", "info"],
    )
    driver = webdriver.Firefox(options=options, service=service)
    try:
        addon_id = driver.install_addon(str(xpi), temporary=True)
        with driver.context(driver.CONTEXT_CHROME):
            runtime_uuid = driver.execute_script(
                """
                return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;
                """,
                addon_id,
            )
        # A fresh profile has no gene catalog, and readers refuse to mount
        # without one. Download it from production once, up front, so a slow
        # first download cannot masquerade as a PDF routing failure.
        driver.set_script_timeout(120)
        driver.get(f"moz-extension://{runtime_uuid}/popup.html")
        gene_count = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            chrome.runtime.sendMessage({ type: "GET_GENE_DATA" }).then(
              payload => done(Object.keys(payload?.genes || {}).length),
              error => done(-1),
            );
            """
        )
        assert gene_count > 1000, f"gene catalog did not download: {gene_count}"
        driver.get("about:blank")
        identity = {
            "geneCount": gene_count,
            "addonId": addon_id,
            "runtimeUuid": runtime_uuid,
            "browserVersion": driver.capabilities.get("browserVersion"),
            "geckodriverVersion": driver.capabilities.get("moz:geckodriverVersion"),
            "profile": driver.capabilities.get("moz:profile"),
            "processId": driver.capabilities.get("moz:processID"),
            "xpiSha256": hashlib.sha256(xpi.read_bytes()).hexdigest(),
        }
        (artifacts / "run-identity.json").write_text(
            json.dumps(identity, indent=2, sort_keys=True), encoding="utf-8"
        )
        yield driver, runtime_uuid
    finally:
        driver.quit()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" or not report.failed:
        return
    if "firefox" not in item.fixturenames:
        return
    driver, _runtime_uuid = item.funcargs["firefox"]
    artifacts = Path(item.config.getoption("--artifacts")).resolve()
    stem = item.name
    try:
        driver.save_screenshot(str(artifacts / f"FAILED-{stem}.png"))
        state = driver.execute_script(
            """
            return {
              url: location.href,
              readerState: document.body?.dataset?.readerState || null,
              bridgeReady: Boolean(globalThis.IconoplasmReaderBridge),
              anchors: document.querySelectorAll('.iconoplasm-pdf-hit-anchor').length,
              textLayers: document.querySelectorAll('.textLayer').length,
              status: document.getElementById('reader-status-message')?.innerText || null,
              html: document.documentElement.outerHTML.slice(0, 4000),
            };
            """
        )
        (artifacts / f"FAILED-{stem}.json").write_text(
            json.dumps(state, indent=2), encoding="utf-8"
        )
    except Exception as error:  # diagnostics must never mask the real failure
        (artifacts / f"FAILED-{stem}.json").write_text(str(error), encoding="utf-8")
