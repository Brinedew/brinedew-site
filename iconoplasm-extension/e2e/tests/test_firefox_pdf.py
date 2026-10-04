from __future__ import annotations

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
        value = "on" if enabled else "off"
        radio = None
        # Firefox occasionally leaves a fresh extension tab blank on the first
        # load; reloading the popup is what a user would do.
        for attempt in range(3):
            driver.get(f"moz-extension://{runtime_uuid}/popup.html")
            try:
                radio = wait(
                    driver,
                    lambda current: current.find_element(
                        By.CSS_SELECTOR,
                        f'input[name="pdf-highlighting"][value="{value}"]',
                    ),
                    timeout=10,
                )
                break
            except TimeoutException:
                if attempt == 2:
                    raise
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
        assert {
            key: capability[key] for key in ("ok", "supported", "driver", "enabled")
        } == {
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
        assert host_access is True, (
            "Firefox installed the add-on without its declared host access"
        )
    finally:
        driver.close()
        driver.switch_to.window(caller)


def pause(driver, milliseconds: int) -> None:
    driver.execute_async_script(
        "const done = arguments[arguments.length - 1]; setTimeout(done, arguments[0]);",
        milliseconds,
    )


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
            "iconoplasm_card_snapshot_version",
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
          text: [tooltip.innerText || '', frame?.contentDocument?.body?.innerText || '']
            .join(' ')
            .replace(/\\s+/g, ' ')
            .trim(),
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
    status = wait(
        driver, lambda current: current.find_element(By.ID, "reader-status-message")
    )
    wait(driver, lambda _current: "Choose" in status.text)
    assert f"Choose {paper.name} once" in status.text
    assert "exact path will be copied" in status.text
    assert "press Ctrl+V, then Open" in status.text

    picker_handoff = driver.execute_script(
        """
        const input = document.getElementById("pdf-file");
        const action = document.getElementById("reader-open-file-action");
        const originalInputClick = input.click;
        const originalWriteText = navigator.clipboard.writeText;
        const proof = { copiedPath: null, pickerOpened: false };
        input.click = () => { proof.pickerOpened = true; };
        navigator.clipboard.writeText = (value) => {
          proof.copiedPath = value;
          return Promise.resolve();
        };
        action.click();
        input.click = originalInputClick;
        navigator.clipboard.writeText = originalWriteText;
        return proof;
        """
    )
    assert picker_handoff == {"copiedPath": str(paper), "pickerOpened": True}

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
            lambda current: current.find_element(
                By.CSS_SELECTOR, ".iconoplasm-pdf-hit-anchor"
            ),
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
    assert "BRCA1 DNA repair associated" in portrait["text"]
    assert "Portrait pending" not in portrait["text"]
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
    # Submit through the page: the same browser POST navigation the button makes. A WebDriver
    # click right after set_pdf_highlighting closed its tab was sometimes swallowed (CI run
    # 37204717543 failed with the form still on screen and no POST sent).
    driver.execute_script("document.querySelector('form').requestSubmit()")
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


# Failure mode: with PDF highlighting Off the add-on still hijacks a local file
# and Firefox's built-in viewer never gets to render it.
def test_local_pdf_with_highlighting_off_stays_in_native_viewer(
    firefox, request
) -> None:
    driver, runtime_uuid = firefox
    paper = Path(request.config.getoption("--paper")).resolve()
    driver.get("about:blank")
    set_pdf_highlighting(driver, runtime_uuid, False)
    driver.get(paper.as_uri())
    wait(driver, native_pdf_page_is_rendered, timeout=60)
    assert not reader_is_mounted(driver)
    assert driver.current_url.startswith("file:")
    assert "geckoLocalFile=" not in driver.current_url


# Failure mode: a file: navigation gets a response filter and is rewritten into
# the HTML redirect shell. The background exposes no filter-count observable, so
# this asserts the closest one: the redirect shell (only the filter writes it,
# marked data-iconoplasm-gecko-pdf-source) never appears, and the tab reaches
# the private reader through the tabs.update path (geckoLocalFile= URL).
def test_local_pdf_navigation_gets_no_response_filter(firefox, request) -> None:
    driver, runtime_uuid = firefox
    paper = Path(request.config.getoption("--paper")).resolve()
    driver.get("about:blank")
    set_pdf_highlighting(driver, runtime_uuid, True)
    driver.get(paper.as_uri())
    wait_for_reader(driver, runtime_uuid)
    assert "geckoLocalFile=" in driver.current_url
    shell_marker = driver.execute_script(
        "return document.documentElement.getAttribute('data-iconoplasm-gecko-pdf-source')"
    )
    assert shell_marker is None


# Failure mode: clicking inside the hover card (which moves focus into its
# iframe) dismisses the card before the reader can use it.
def test_card_keeps_focus_when_its_iframe_is_focused(firefox, pdf_server) -> None:
    driver, runtime_uuid = firefox
    driver.get(f"{pdf_server.origin}/form/post.html")
    set_pdf_highlighting(driver, runtime_uuid, True)
    driver.get(f"{pdf_server.origin}/pdf/get.pdf")
    wait_for_reader(driver, runtime_uuid)
    anchor = wait(
        driver,
        lambda current: current.find_element(
            By.CSS_SELECTOR, ".iconoplasm-pdf-hit-anchor"
        ),
        timeout=60,
    )
    ActionChains(driver).move_to_element(anchor).perform()
    tooltip_selector = ".iconoplasm-tooltip.iconoplasm-tooltip-visible"
    wait(driver, lambda current: current.find_element(By.CSS_SELECTOR, tooltip_selector))
    frame = wait(
        driver,
        lambda current: current.find_element(
            By.CSS_SELECTOR, ".iconoplasm-tooltip iframe"
        ),
    )
    # Pointer into the card. duration=0: Selenium's default 250 ms glide outlasts the card's 220 ms
    # leave grace, which no human pointer move into an adjacent card does.
    ActionChains(driver, duration=0).move_to_element(frame).perform()
    pause(driver, 600)
    assert driver.find_elements(By.CSS_SELECTOR, tooltip_selector), (
        "the card closed when the pointer moved into it"
    )
    # Move focus into the card the way keyboard users do. (A pointer click is
    # no use here: the whole card is a link that opens the gene page in a new
    # tab, which legitimately closes the card.)
    driver.switch_to.frame(frame)
    try:
        driver.execute_script(
            "window.focus(); document.body.tabIndex = -1; document.body.focus();"
        )
    finally:
        driver.switch_to.default_content()
    # Prove focus really moved into the card's iframe.
    assert driver.execute_script("return document.activeElement?.tagName") == "IFRAME"
    # Give a dismiss-on-blur handler time to fire before asserting.
    pause(driver, 1500)
    assert driver.find_elements(By.CSS_SELECTOR, tooltip_selector), {
        "message": "the card closed when its iframe took focus",
        "documentHasFocus": driver.execute_script("return document.hasFocus()"),
        "activeElement": driver.execute_script("return document.activeElement?.tagName"),
    }
