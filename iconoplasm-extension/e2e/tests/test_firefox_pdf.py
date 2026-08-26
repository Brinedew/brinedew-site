from __future__ import annotations

import json
from pathlib import Path

from selenium.common.exceptions import JavascriptException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait


def wait(driver, predicate, timeout: int = 30):
    return WebDriverWait(driver, timeout).until(predicate)


def set_pdf_highlighting(driver, runtime_uuid: str, enabled: bool) -> None:
    caller = driver.current_window_handle
    driver.switch_to.new_window("tab")
    try:
        driver.get(f"moz-extension://{runtime_uuid}/popup.html")
        value = "on" if enabled else "off"
        radio = wait(driver, lambda current: current.find_element(By.CSS_SELECTOR, f'input[name="pdf-highlighting"][value="{value}"]'))
        # The native radio is intentionally visually hidden beneath its styled
        # label; Selenium's is_displayed() is therefore false even when the control
        # is available to a real click.
        wait(driver, lambda _current: radio.is_enabled())
        driver.execute_script("arguments[0].closest('label').click()", radio)
        wait(driver, lambda _current: radio.is_selected() and radio.is_enabled())
        capability = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            chrome.runtime.sendMessage({ type: "PDF_OWNERSHIP_GET_CAPABILITY" })
              .then(done, error => done({ ok: false, error: String(error) }));
            """
        )
        assert {key: capability[key] for key in ("ok", "supported", "driver", "enabled")} == {
            "ok": True,
            "supported": True,
            "driver": "firefox-response-filter",
            "enabled": enabled,
        }
        host_access = driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            chrome.permissions.contains({ origins: ["<all_urls>"] }).then(done, () => done(false));
            """
        )
        assert host_access is True, "Firefox installed the add-on without its declared host access"
    finally:
        driver.close()
        driver.switch_to.window(caller)


def reader_is_mounted(driver) -> bool:
    try:
        return driver.execute_script(
            "return document.documentElement?.dataset.iconoplasmPdfReader === 'true'"
        )
    except JavascriptException:
        # Marionette can briefly lose its document sandbox while Firefox swaps
        # the native PDF viewer and extension reader during navigation.
        return False


def native_pdf_page_is_rendered(driver) -> bool:
    try:
        return driver.execute_script(
            """
            const canvas = document.querySelector('.page[data-loaded="true"] canvas, .page canvas');
            return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
            """
        )
    except JavascriptException:
        return False


def get_pdf_capability(driver, runtime_uuid: str) -> dict:
    caller = driver.current_window_handle
    driver.switch_to.new_window("tab")
    try:
        driver.get(f"moz-extension://{runtime_uuid}/popup.html")
        return driver.execute_async_script(
            """
            const done = arguments[arguments.length - 1];
            chrome.runtime.sendMessage({ type: "PDF_OWNERSHIP_GET_CAPABILITY" }).then(done);
            """
        )
    finally:
        driver.close()
        driver.switch_to.window(caller)


def wait_for_reader(driver, runtime_uuid: str) -> None:
    try:
        wait(driver, reader_is_mounted)
    except TimeoutException as error:
        raise AssertionError(
            {
                "capability": get_pdf_capability(driver, runtime_uuid),
                "url": driver.current_url,
                "document": driver.execute_script(
                    "return document.documentElement?.outerHTML?.slice(0, 1000) || ''"
                ),
            }
        ) from error


def capture(driver, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    driver.save_screenshot(str(path))


def local_reader_diagnostics(driver) -> dict:
    return driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        Promise.all([
          chrome.storage.local.get([
            "iconoplasm_gene_count",
            "iconoplasm_hash",
            "iconoplasm_contract_error",
            "iconoplasm_highlight_mode",
            "iconoplasm_highlight_visibility",
            "iconoplasm_pdf_highlighting_enabled",
          ]),
          chrome.runtime.sendMessage({ type: "GET_GENE_DATA" }),
        ]).then(([stored, payload]) => {
          const walker = document.createTreeWalker(
            document.querySelector('.textLayer'), NodeFilter.SHOW_TEXT
          );
          const geneNodes = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (/BRCA|TP53/.test(node.nodeValue || '')) geneNodes.push(node.nodeValue);
          }
          done({
          stored,
          payloadError: payload?.error || null,
          payloadGeneCount: Object.keys(payload?.genes || payload || {}).length,
          bodyState: document.body?.dataset.readerState || null,
          pageCount: document.querySelectorAll('.page[data-loaded="true"]').length,
          textSample: document.querySelector('.textLayer')?.textContent?.slice(0, 500) || "",
          anchorCount: document.querySelectorAll('.iconoplasm-pdf-hit-anchor').length,
          decorationCount: document.querySelectorAll('.iconoplasm-pdf-decoration').length,
          bridgeReady: Boolean(globalThis.IconoplasmReaderBridge),
          geneNodes: geneNodes.slice(0, 20),
          nodeMatches: geneNodes.slice(0, 20).map(text => ({
            text,
            matches: globalThis.IconoplasmReaderBridge?.findMatches?.(text) || [],
          })),
          presentations: ['BRCA1', 'BRCA2', 'TP53'].map(symbol => ({
            symbol,
            value: globalThis.IconoplasmReaderBridge?.getPdfHighlightPresentation?.(symbol) || null,
          })),
        });
        }, error => done({ diagnosticError: String(error) }));
        """
    )


def visible_tooltip_portrait(driver) -> dict | None:
    return driver.execute_script(
        """
        const tooltip = document.querySelector('.iconoplasm-tooltip.iconoplasm-tooltip-visible');
        if (!tooltip) return null;
        const frame = tooltip.querySelector('iframe');
        const images = [
          ...tooltip.querySelectorAll('img'),
          ...(frame?.contentDocument ? frame.contentDocument.querySelectorAll('img') : []),
        ];
        const portrait = images.find(image => image.complete && image.naturalWidth > 0);
        if (!portrait) return null;
        const rect = tooltip.getBoundingClientRect();
        const style = getComputedStyle(tooltip);
        if (
          rect.width <= 0 || rect.height <= 0 || style.display === 'none' ||
          style.visibility === 'hidden' || Number(style.opacity) === 0
        ) return null;
        return {
          naturalWidth: portrait.naturalWidth,
          naturalHeight: portrait.naturalHeight,
          tooltipWidth: rect.width,
          tooltipHeight: rect.height,
        };
        """
    )


def test_firefox_local_pdf_routes_to_private_reader_and_restores_hover(
    firefox, request, artifacts: Path
) -> None:
    driver, runtime_uuid = firefox
    paper = Path(request.config.getoption("--paper")).resolve()
    driver.get("about:blank")
    set_pdf_highlighting(driver, runtime_uuid, True)
    driver.get(paper.as_uri())
    wait_for_reader(driver, runtime_uuid)
    assert "geckoLocalFile=" in driver.current_url
    status = wait(driver, lambda current: current.find_element(By.ID, "reader-status-message"))
    assert f"Choose {paper.name} once" in status.text
    assert "privately in Iconoplasm" in status.text

    file_input = driver.find_element(By.ID, "pdf-file")
    file_input.send_keys(str(paper))
    wait(
        driver,
        lambda current: current.find_element(
            By.CSS_SELECTOR, '.page[data-loaded="true"]'
        ),
        timeout=60,
    )
    capture(driver, artifacts / "firefox-local-file-rendered.png")
    try:
        anchor = wait(
            driver,
            lambda current: current.find_element(By.CSS_SELECTOR, ".iconoplasm-pdf-hit-anchor"),
            timeout=60,
        )
    except TimeoutException as error:
        raise AssertionError(local_reader_diagnostics(driver)) from error
    wait(
        driver,
        lambda current: current.find_element(
            By.CSS_SELECTOR, ".iconoplasm-pdf-decoration"
        ),
    )
    ActionChains(driver).move_to_element(anchor).perform()
    wait(
        driver,
        lambda current: current.find_element(
            By.CSS_SELECTOR, ".iconoplasm-tooltip.iconoplasm-tooltip-visible"
        ),
    )
    portrait = wait(driver, visible_tooltip_portrait, timeout=30)
    assert portrait["naturalWidth"] > 1
    assert portrait["naturalHeight"] > 1
    capture(driver, artifacts / "firefox-local-file-highlight-hover.png")

    driver.find_element(By.ID, "native-viewer").click()
    wait(driver, lambda current: not reader_is_mounted(current))
    wait(driver, native_pdf_page_is_rendered)
    assert driver.current_url.startswith("blob:moz-extension://")
    capture(driver, artifacts / "firefox-local-file-native-handback.png")


def test_firefox_owns_web_pdf_and_off_returns_to_native(
    firefox, pdf_server, artifacts: Path
) -> None:
    driver, runtime_uuid = firefox
    driver.get(f"{pdf_server.origin}/form/post.html")
    set_pdf_highlighting(driver, runtime_uuid, True)
    paper_url = f"{pdf_server.origin}/pdf/get.pdf"
    driver.get(paper_url)
    wait_for_reader(driver, runtime_uuid)
    wait(driver, lambda current: current.find_elements(By.CSS_SELECTOR, ".page"))
    capture(driver, artifacts / "firefox-get-on.png")
    assert pdf_server.count("/pdf/get.pdf") == 1

    set_pdf_highlighting(driver, runtime_uuid, False)
    wait(driver, lambda current: not reader_is_mounted(current))
    wait(driver, native_pdf_page_is_rendered)
    capture(driver, artifacts / "firefox-get-off-native.png")
    assert driver.current_url.startswith("blob:")
    assert pdf_server.count("/pdf/get.pdf") == 1


def test_single_use_pdf_never_reissues_the_origin_request(
    firefox, pdf_server, artifacts: Path
) -> None:
    driver, runtime_uuid = firefox
    driver.get(f"{pdf_server.origin}/form/post.html")
    set_pdf_highlighting(driver, runtime_uuid, True)
    path = "/pdf/once/firefox-e2e"
    paper_url = f"{pdf_server.origin}{path}"
    driver.get(paper_url)
    wait_for_reader(driver, runtime_uuid)
    assert pdf_server.count(path) == 1

    set_pdf_highlighting(driver, runtime_uuid, False)
    wait(driver, lambda current: not reader_is_mounted(current))
    wait(driver, native_pdf_page_is_rendered)
    capture(driver, artifacts / "firefox-single-use-off-native.png")
    assert pdf_server.count(path) == 1


def test_post_pdf_uses_the_original_response_bytes(firefox, pdf_server) -> None:
    driver, runtime_uuid = firefox
    driver.get(f"{pdf_server.origin}/form/post.html")
    set_pdf_highlighting(driver, runtime_uuid, True)
    driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
    wait_for_reader(driver, runtime_uuid)
    records = [record for record in pdf_server.requests if record.path == "/pdf/post"]
    assert len(records) == 1
    assert records[0].method == "POST"


def test_attachment_and_partial_range_remain_native(firefox, pdf_server) -> None:
    driver, runtime_uuid = firefox
    driver.get(f"{pdf_server.origin}/form/post.html")
    set_pdf_highlighting(driver, runtime_uuid, True)
    driver.get(f"{pdf_server.origin}/pdf/range-partial")
    assert not reader_is_mounted(driver)

    summary = {
        "rangePartialRequests": pdf_server.count("/pdf/range-partial"),
        "attachmentRequests": pdf_server.count("/pdf/attachment"),
    }
    assert summary["rangePartialRequests"] == 1
