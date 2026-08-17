from __future__ import annotations

import json
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
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
    return driver.execute_script(
        "return document.documentElement.dataset.iconoplasmPdfReader === 'true'"
    )


def native_pdf_page_is_rendered(driver) -> bool:
    return driver.execute_script(
        """
        const canvas = document.querySelector('.page[data-loaded="true"] canvas, .page canvas');
        return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
        """
    )


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
