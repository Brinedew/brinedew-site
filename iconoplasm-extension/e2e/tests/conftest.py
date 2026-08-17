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


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--firefox-binary", required=True)
    parser.addoption("--xpi", required=True)
    parser.addoption("--paper", required=True)
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
    binary = Path(request.config.getoption("--firefox-binary")).resolve()
    xpi = Path(request.config.getoption("--xpi")).resolve()
    options = Options()
    options.binary_location = str(binary)
    options.set_preference("browser.download.useDownloadDir", True)
    options.set_preference("browser.download.folderList", 2)
    options.set_preference("browser.download.dir", str(artifacts / "downloads"))
    options.set_preference("browser.download.alwaysOpenPanel", False)
    driver_path = SeleniumManager().binary_paths(
        [
            "--browser",
            "firefox",
            "--browser-path",
            str(binary),
            "--skip-driver-in-path",
        ]
    )["driver_path"]
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
        identity = {
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
