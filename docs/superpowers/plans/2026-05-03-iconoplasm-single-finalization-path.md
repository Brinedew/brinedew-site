# Iconoplasm Single Finalization Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Website Ops Sync button use exactly one finalization path: durable D1 ledger -> Cloudflare Queue `drain_finalization_ledger` -> queue consumer, with fail-loud behavior and no legacy direct processor fallback.

**Architecture:** The workstation starts sync from the GUI, enqueues finalization ledger rows, sends or proves one canonical Queue kick, then observes `/finalization/pending` until the queue consumer drains the ledger. The website worker owns execution; the workstation never calls `/api/iconoplasm/admin/finalization/process` and never simulates queue progress. Legacy helpers, fake compatibility paths, and tests that preserve the old direct processor are removed or rewritten as tombstone guards.

**Tech Stack:** Python workstation app in `D:/Coding/Iconoplasm`, React Website Ops UI in `D:/Coding/Iconoplasm/webui`, Cloudflare Worker in `D:/Coding/Website/workers`, Node test runner via `npx tsx --test`, Python tests via project `.venv/Scripts/python.exe -m pytest`.

---

## File Structure

- Modify `D:/Coding/Iconoplasm/src/iconoplasm.py`
  - Remove workstation-side direct finalization processing.
  - Add Queue kick helper and Queue-backed drain wait loop.
  - Keep budget and pending-state observation, not execution.

- Modify `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`
  - Delete fake direct processor assumptions.
  - Add tests proving sync never calls `/finalization/process`.
  - Add tests proving Queue kick failure stops sync before claiming success.
  - Add tests proving pending polling handles drained, deferred, and stuck states.

- Modify `D:/Coding/Website/workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
  - Keep `/finalization/process` as a 410 tombstone.
  - Ensure `/finalization/enqueue` and `/finalization/kick` both use the same Queue message builder.
  - Fail loud with raw Queue send reason when Cloudflare rejects Queue sends.

- Modify `D:/Coding/Website/workers/iconoplasm.sync-finalization-queue.test.js`
  - Strengthen tests for enqueue/kick using only `drain_finalization_ledger`.
  - Keep the 410 tombstone test.

- Modify `D:/Coding/Website/workers/iconoplasm.do-not-delete-cost-guards.test.js`
  - Add a guard that no workstation/direct-process wording reappears in the worker.

- Modify `D:/Coding/Website/docs/ICONOPLASM_OPERATIONS.md`
  - Document the one true sync path and the exact failure modes operators should expect.

---

### Task 1: Website Worker Path Contract

**Files:**

- Modify: `D:/Coding/Website/workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- Test: `D:/Coding/Website/workers/iconoplasm.sync-finalization-queue.test.js`

- [ ] **Step 1: Write the failing worker contract test**

Add this test near the existing finalization enqueue/kick tests in `D:/Coding/Website/workers/iconoplasm.sync-finalization-queue.test.js`:

```js
test("admin finalization enqueue and kick both send only the canonical Queue drain message", async () => {
  const enqueueQueue = buildFakeQueue()
  const enqueueResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/enqueue", {
        method: "POST",
        headers: {
          "x-iconoplasm-admin-token": "secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "pytest-enqueue",
          process_now: false,
          rows: [
            {
              symbol: "TP53",
              phase: "reconcile",
              keep: [{ symbol: "TP53", asset_sha256: "a".repeat(64) }],
              legacy: [],
              vision_ids: ["anima-v1-1"],
            },
          ],
        }),
      }),
      {
        ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
        ICONOPLASM_SYNC_FINALIZATION_QUEUE: enqueueQueue,
      },
      { waitUntil() {} },
    )
  const enqueuePayload = await enqueueResponse.json()

  assert.equal(enqueueResponse.status, 200)
  assert.equal(enqueuePayload?.ok, true)
  assert.equal(enqueueQueue.sent.length, 1)
  assert.equal(enqueueQueue.sent[0]?.kind, "drain_finalization_ledger")
  assert.equal(enqueuePayload?.process, null)

  const kickQueue = buildFakeQueue()
  const kickResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/kick", {
        method: "POST",
        headers: {
          "x-iconoplasm-admin-token": "secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ run_id: "pytest-run", reason: "pytest-kick" }),
      }),
      {
        ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
        ICONOPLASM_SYNC_FINALIZATION_QUEUE: kickQueue,
      },
      { waitUntil() {} },
    )
  const kickPayload = await kickResponse.json()

  assert.equal(kickResponse.status, 200)
  assert.equal(kickPayload?.ok, true)
  assert.equal(kickQueue.sent.length, 1)
  assert.equal(kickQueue.sent[0]?.kind, "drain_finalization_ledger")
  assert.equal(kickPayload?.process, null)
})
```

- [ ] **Step 2: Run the worker test and confirm current behavior**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Website'; npx tsx --test workers/iconoplasm.sync-finalization-queue.test.js }
if (-not (Wait-Job $job -Timeout 120)) { Stop-Job $job; throw 'worker finalization queue test timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'worker finalization queue test failed' }
```

Expected: test either passes already or fails only where enqueue still returns a direct `process` payload. It must not require adding a fallback.

- [ ] **Step 3: Make enqueue/kick share Queue send behavior**

In `D:/Coding/Website/workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`, keep `buildSyncFinalizationDrainQueueMessage(...)` and `sendSyncFinalizationDrainQueueMessage(...)` as the only message construction/sending layer. Ensure the enqueue handler calls `sendSyncFinalizationDrainQueueMessage(...)` after ledger rows are written and returns:

```js
{
  ok: true,
  enqueued: insertedOrUpdatedCount,
  queue_enabled: true,
  queue_messages: 1,
  queue_send_failures: 0,
  process: null,
}
```

On Queue send failure, return HTTP `503` with:

```js
{
  ok: false,
  code: "QUEUE_SEND_FAILED",
  error: "Cloudflare rejected the sync finalization Queue message.",
  queue_send_error: sentQueueMessage,
  process: null,
}
```

Do not add or revive direct processing.

- [ ] **Step 4: Re-run the worker finalization test**

Run the same PowerShell command from Step 2.

Expected: PASS.

---

### Task 2: Workstation Queue Kick Helper

**Files:**

- Modify: `D:/Coding/Iconoplasm/src/iconoplasm.py`
- Test: `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`

- [ ] **Step 1: Write failing tests for Queue kick success and failure**

Add tests near the current finalization helper tests in `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`:

```python
def test_remote_finalization_kick_uses_canonical_queue_route(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(*, base_url, api_path, payload, admin_token, timeout_seconds):
        captured.update(
            {
                "base_url": base_url,
                "api_path": api_path,
                "payload": payload,
                "admin_token": admin_token,
                "timeout_seconds": timeout_seconds,
            }
        )
        return {"ok": True, "queue_enabled": True, "queue_messages": 1, "process": None}

    monkeypatch.setattr(iconoplasm, "_post_iconoplasm_admin_json", fake_post)

    payload = iconoplasm._remote_iconoplasm_kick_finalization_queue(
        base_url="https://iconoplasm.brinedew.bio",
        admin_token="secret",
        run_id="pytest-run",
        reason="pytest",
        symbols=["tp53", "BRCA1"],
        timeout_seconds=123,
    )

    assert payload["ok"] is True
    assert captured["api_path"] == "/api/iconoplasm/admin/finalization/kick"
    assert captured["payload"]["run_id"] == "pytest-run"
    assert captured["payload"]["reason"] == "pytest"
    assert captured["payload"]["symbols"] == ["TP53", "BRCA1"]
    assert captured["timeout_seconds"] == 123


def test_remote_finalization_kick_fails_loud_when_queue_rejects(monkeypatch) -> None:
    def fake_post(**kwargs):
        return {
            "ok": False,
            "code": "QUEUE_SEND_FAILED",
            "queue_send_error": {"detail": "Too Many Requests"},
        }

    monkeypatch.setattr(iconoplasm, "_post_iconoplasm_admin_json", fake_post)

    with pytest.raises(RuntimeError, match="Cloudflare Queue proof failed"):
        iconoplasm._remote_iconoplasm_kick_finalization_queue(
            base_url="https://iconoplasm.brinedew.bio",
            admin_token="secret",
            run_id="pytest-run",
            reason="pytest",
            timeout_seconds=123,
        )
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py::test_remote_finalization_kick_uses_canonical_queue_route tests/test_react_workstation_api.py::test_remote_finalization_kick_fails_loud_when_queue_rejects -q }
if (-not (Wait-Job $job -Timeout 120)) { Stop-Job $job; throw 'workstation queue kick tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'workstation queue kick tests failed' }
```

Expected: FAIL because `_remote_iconoplasm_kick_finalization_queue` does not exist yet.

- [ ] **Step 3: Implement `_remote_iconoplasm_kick_finalization_queue`**

Add this helper after `_remote_iconoplasm_enqueue_finalization(...)` in `D:/Coding/Iconoplasm/src/iconoplasm.py`:

```python
def _remote_iconoplasm_kick_finalization_queue(
    *,
    base_url: str,
    admin_token: str,
    run_id: str = "",
    reason: str = "workstation_sync_finalization",
    symbols: list[str] | None = None,
    timeout_seconds: int = 300,
) -> dict:
    safe_symbols = sorted(
        {
            symbol
            for symbol in (
                _normalize_gene_symbol(raw_symbol)
                for raw_symbol in list(symbols or [])
            )
            if symbol
        }
    )
    payload = {
        "run_id": str(run_id or reason or "workstation_sync_finalization").strip() or "workstation_sync_finalization",
        "reason": str(reason or "workstation_sync_finalization").strip() or "workstation_sync_finalization",
        "symbols": safe_symbols,
    }
    response = _post_iconoplasm_admin_json(
        base_url=base_url,
        api_path="/api/iconoplasm/admin/finalization/kick",
        payload=payload,
        admin_token=admin_token,
        timeout_seconds=timeout_seconds,
    )
    if not bool(response.get("ok")):
        detail = response.get("queue_send_error") or response
        raise RuntimeError(
            "Cloudflare Queue proof failed before sync work; the Sync button cannot complete "
            f"until the canonical Queue path accepts a drain message. {detail}"
        )
    if int(response.get("queue_messages") or 0) <= 0:
        raise RuntimeError(
            "Cloudflare Queue proof failed before sync work; the finalization kick returned no Queue message."
        )
    return response
```

- [ ] **Step 4: Run the helper tests again**

Run the same PowerShell command from Step 2.

Expected: PASS.

---

### Task 3: Delete Workstation Direct Finalization Processing

**Files:**

- Modify: `D:/Coding/Iconoplasm/src/iconoplasm.py`
- Test: `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`

- [ ] **Step 1: Add a guard test that the sync path never calls `/finalization/process`**

Add this test near the sync pipeline tests in `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`:

```python
def test_sync_pipeline_never_calls_direct_finalization_process(monkeypatch, tmp_path) -> None:
    called_paths: list[str] = []

    def fake_post(*, api_path, **kwargs):
        called_paths.append(api_path)
        if api_path == "/api/iconoplasm/admin/finalization/process":
            raise AssertionError("direct finalization process route must not be called")
        if api_path == "/api/iconoplasm/admin/finalization/enqueue":
            return {"ok": True, "enqueued": 1, "queue_messages": 1, "process": None}
        if api_path == "/api/iconoplasm/admin/finalization/kick":
            return {"ok": True, "queue_messages": 1, "process": None}
        return {"ok": True, "processed": 0, "invalid": 0}

    monkeypatch.setattr(iconoplasm, "_post_iconoplasm_admin_json", fake_post)
    monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_finalization_pending", lambda **kwargs: {
        "ok": True,
        "summary": {"total_pending": 0},
        "jobs": [],
    })

    # Use the smallest existing fake app/control-plane fixture in this file.
    # The assertion is about route shape, not data volume.
    result = iconoplasm._run_iconoplasm_local_sync_pipeline(
        control_plane=FakeControlPlaneWithOneChangedSymbol(tmp_path),
        vote_user_id="local",
        base_url="https://iconoplasm.brinedew.bio",
        admin_token="secret",
        upload_batch_size=6,
        created_by="pytest",
        reason="pytest",
        progress_callback=lambda *args, **kwargs: None,
    )

    assert result["ok"] is True
    assert "/api/iconoplasm/admin/finalization/process" not in called_paths
    assert "/api/iconoplasm/admin/finalization/kick" in called_paths
```

If this file does not already have `FakeControlPlaneWithOneChangedSymbol`, create a tiny local fixture class in the test using the same methods as the nearest existing `_run_iconoplasm_local_sync_pipeline` test fixture. Do not use live data.

- [ ] **Step 2: Run the guard test and verify it fails**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py::test_sync_pipeline_never_calls_direct_finalization_process -q }
if (-not (Wait-Job $job -Timeout 180)) { Stop-Job $job; throw 'direct-finalization guard test timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'direct-finalization guard test failed' }
```

Expected: FAIL because the current drain loop still calls `/api/iconoplasm/admin/finalization/process`.

- [ ] **Step 3: Remove `_remote_iconoplasm_process_finalization`**

Delete this function from `D:/Coding/Iconoplasm/src/iconoplasm.py`:

```python
def _remote_iconoplasm_process_finalization(...):
    ...
```

Also delete `_is_retryable_iconoplasm_finalization_process_error(...)` if nothing else uses it after the drain loop is replaced.

- [ ] **Step 4: Replace the drain loop with Queue kick + pending polling**

Inside `_drain_finalization_queue_until_complete()` in `D:/Coding/Iconoplasm/src/iconoplasm.py`, replace all direct process-loop logic with this shape:

```python
def _drain_finalization_queue_until_complete() -> None:
    finalization_scope_chunk_size = 5000
    poll_delays_seconds = (5.0, 10.0, 15.0, 30.0)
    max_idle_polls = 24
    idle_polls = 0
    last_pending_total: int | None = None

    def _emit_finalization_progress(detail: str) -> None:
        _emit_progress(
            "refresh_read_models",
            read_model_batches_completed=read_model_batches_completed,
            read_model_batches_total=read_model_total_batches,
            read_model_symbols_completed=read_model_symbols_completed,
            read_model_symbols_total=len(read_model_symbols),
            reconcile_chunks_completed=reconcile_batches_completed,
            reconcile_chunks_total=reconcile_total_batches,
            reconcile_symbols_completed=reconcile_symbols_completed,
            reconcile_symbols_total=len(reconcile_symbols),
            detail=detail,
        )

    def _fetch_pending_snapshot(*, limit: int = 200, symbols: list[str] | None = None) -> dict[str, object]:
        pending_snapshot = _remote_iconoplasm_finalization_pending(
            base_url=base_url,
            admin_token=admin_token,
            limit=max(1, int(limit or 200)),
            symbols=list(symbols or []),
            timeout_seconds=120,
        )
        _capture_budget_runtime(pending_snapshot, bucket="finalization")
        return dict(pending_snapshot or {}) if isinstance(pending_snapshot, dict) else {}

    def _pending_total(snapshot: object) -> int:
        payload = dict(snapshot or {}) if isinstance(snapshot, dict) else {}
        summary = dict(payload.get("summary") or {}) if isinstance(payload.get("summary"), dict) else {}
        return max(0, int(summary.get("total_pending") or 0))

    queue_symbols = sorted(
        set(reconcile_symbols)
        | set(read_model_symbols)
    )
    if not queue_symbols:
        first_snapshot = _fetch_pending_snapshot(limit=1)
        if _pending_total(first_snapshot) <= 0:
            _emit_finalization_progress("No durable website finalization backlog remains.")
            return

    for start in range(0, len(queue_symbols), finalization_scope_chunk_size):
        _check_cancel()
        symbol_chunk = queue_symbols[start:start + finalization_scope_chunk_size]
        _remote_iconoplasm_kick_finalization_queue(
            base_url=base_url,
            admin_token=admin_token,
            run_id=str(started_epoch or ""),
            reason=reason,
            symbols=symbol_chunk,
            timeout_seconds=300,
        )

    if not queue_symbols:
        _remote_iconoplasm_kick_finalization_queue(
            base_url=base_url,
            admin_token=admin_token,
            run_id=str(started_epoch or ""),
            reason=reason,
            symbols=[],
            timeout_seconds=300,
        )

    while True:
        _check_cancel()
        snapshot = _fetch_pending_snapshot(limit=200)
        pending_total = _pending_total(snapshot)
        if pending_total <= 0:
            _emit_finalization_progress("Cloudflare Queue drained durable website finalization backlog.")
            return
        if last_pending_total is None or pending_total < last_pending_total:
            idle_polls = 0
            last_pending_total = pending_total
        else:
            idle_polls += 1
        if idle_polls >= max_idle_polls:
            summary = _summarize_iconoplasm_finalization_pending_snapshot(snapshot, limit=5)
            raise RuntimeError(
                "Cloudflare Queue finalization did not make visible progress after repeated pending checks. "
                f"Pending rows: {pending_total:,}. {summary}"
            )
        delay = poll_delays_seconds[min(idle_polls, len(poll_delays_seconds) - 1)]
        _emit_finalization_progress(
            f"Waiting for Cloudflare Queue to drain website finalization backlog ({pending_total:,} pending)."
        )
        _sleep_with_cancel(delay)
```

Important: do not call `/finalization/process`, do not process rows locally, and do not mark completion unless `/finalization/pending` reaches zero.

- [ ] **Step 5: Run direct-process search**

Run:

```powershell
rg -n "finalization/process|_remote_iconoplasm_process_finalization|process_finalization" D:\Coding\Iconoplasm\src D:\Coding\Iconoplasm\tests
```

Expected: no production references. Test references may only assert the old route is forbidden, not use it as a working path.

- [ ] **Step 6: Run targeted workstation tests**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py -q }
if (-not (Wait-Job $job -Timeout 600)) { Stop-Job $job; throw 'workstation API tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'workstation API tests failed' }
```

Expected: PASS. If unrelated dirty outlier tests fail, isolate with the finalization-related test names and record the unrelated failures before changing anything.

---

### Task 4: Preflight Queue Proof Before Expensive Sync Work

**Files:**

- Modify: `D:/Coding/Iconoplasm/src/iconoplasm.py`
- Test: `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`

- [ ] **Step 1: Write failing action-level preflight test**

Add this test near the `run-sync` action tests:

```python
def test_run_sync_refuses_before_prefect_launch_when_queue_kick_fails(monkeypatch) -> None:
    launched: list[bool] = []

    monkeypatch.setattr(iconoplasm, "_react_refactor_save_operations_settings", lambda payload: {
        "base_url": "https://iconoplasm.brinedew.bio",
        "upload_batch_size": 6,
        "cloudflare_guard_effective_percent": 90,
    })
    monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_mutation_limiter_policy_cached", lambda **kwargs: {
        "mutation_limiter": {
            "active": True,
            "budget_basis": "d1_rows_written_daily_smart_limit",
            "budget_basis_label": "D1 smart daily write budget",
        }
    })
    monkeypatch.setattr(iconoplasm, "_react_refactor_operations_workers_request_usage", lambda **kwargs: {
        "ok": True,
        "daily_requests_limit": 100000,
        "requests_today": 1000,
    })
    monkeypatch.setattr(iconoplasm, "_react_refactor_operations_durable_object_usage", lambda **kwargs: {
        "ok": True,
        "daily_rows_written_limit": 100000,
        "rows_written_today": 1000,
    })
    monkeypatch.setattr(iconoplasm, "_prefect_website_sync_runtime_status", lambda: {"inflight": False, "status": "idle"})
    monkeypatch.setattr(iconoplasm, "_sync_job_is_active", lambda job: False)
    monkeypatch.setattr(iconoplasm, "_read_sync_upload_recovery_progress", lambda: {})
    monkeypatch.setattr(iconoplasm, "_resolve_vote_user_id", lambda: "local")
    monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_kick_finalization_queue", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("Cloudflare Queue proof failed before sync work")))

    def fake_start(**kwargs):
        launched.append(True)
        return True, {"inflight": True}, "started"

    monkeypatch.setattr(iconoplasm, "_start_iconoplasm_sync_prefect_job", fake_start)
    iconoplasm.thoteins.config.setdefault("production", {})["sync_admin_token"] = "secret"

    with pytest.raises(RuntimeError, match="Cloudflare Queue proof failed before sync work"):
        iconoplasm._react_refactor_operations_action("run-sync", {"base_url": "https://iconoplasm.brinedew.bio"})

    assert launched == []
```

- [ ] **Step 2: Run the preflight test and verify it fails**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py::test_run_sync_refuses_before_prefect_launch_when_queue_kick_fails -q }
if (-not (Wait-Job $job -Timeout 120)) { Stop-Job $job; throw 'queue preflight test timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'queue preflight test failed' }
```

Expected: FAIL because `run-sync` does not yet prove Queue sends before launching Prefect.

- [ ] **Step 3: Add Queue proof to `run-sync`**

In `D:/Coding/Iconoplasm/src/iconoplasm.py`, inside `_react_refactor_operations_action(...)` `operation == "run-sync"`, after the D1/Workers/DO guard checks and before `_start_iconoplasm_sync_prefect_job(...)`, add:

```python
        _remote_iconoplasm_kick_finalization_queue(
            base_url=normalized_base_url,
            admin_token=admin_token,
            run_id=f"preflight:{int(time.time())}",
            reason="react_ops_sync_preflight",
            symbols=[],
            timeout_seconds=120,
        )
```

This intentionally spends one Queue operation before expensive local work. If Cloudflare refuses it, the GUI fails immediately instead of burning hours.

- [ ] **Step 4: Run the preflight test again**

Run the same command from Step 2.

Expected: PASS.

---

### Task 5: Remove Compatibility Shims From Tests

**Files:**

- Modify: `D:/Coding/Iconoplasm/tests/test_react_workstation_api.py`

- [ ] **Step 1: Remove fake direct finalization helpers**

Delete or rewrite helpers that emulate workstation-side finalization processing:

```python
install_fake_finalization_queue(...)
_process_finalization(...)
monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_process_finalization", ...)
```

Replace them with fakes for:

```python
monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_enqueue_finalization", fake_enqueue)
monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_kick_finalization_queue", fake_kick)
monkeypatch.setattr(iconoplasm, "_remote_iconoplasm_finalization_pending", fake_pending)
```

The fake pending sequence should look like:

```python
pending_values = iter([{"summary": {"total_pending": 2}, "jobs": []}, {"summary": {"total_pending": 0}, "jobs": []}])

def fake_pending(**kwargs):
    return next(pending_values, {"summary": {"total_pending": 0}, "jobs": []})
```

- [ ] **Step 2: Run a search proving the old fake is gone**

Run:

```powershell
rg -n "install_fake_finalization_queue|_process_finalization|_remote_iconoplasm_process_finalization|finalization/process" D:\Coding\Iconoplasm\tests\test_react_workstation_api.py
```

Expected: no helper/fake usage remains. The only acceptable match is an assertion that the forbidden string is absent.

- [ ] **Step 3: Run finalization-related workstation tests**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py -k "finalization or run_sync or run-sync or website_sync" -q }
if (-not (Wait-Job $job -Timeout 600)) { Stop-Job $job; throw 'workstation finalization tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'workstation finalization tests failed' }
```

Expected: PASS.

---

### Task 6: Guardrails Against Regression

**Files:**

- Modify: `D:/Coding/Website/workers/iconoplasm.do-not-delete-cost-guards.test.js`
- Modify: `D:/Coding/Website/docs/ICONOPLASM_OPERATIONS.md`

- [ ] **Step 1: Add regression guard for forbidden worker paths**

Add this test to `D:/Coding/Website/workers/iconoplasm.do-not-delete-cost-guards.test.js`:

```js
test("Iconoplasm sync finalization keeps one true Queue path and no direct processor", () => {
  const workerSource = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )

  assert.match(
    workerSource,
    /durable D1 ledger rows are advanced by Cloudflare Queue messages of kind/,
  )
  assert.match(workerSource, /drain_finalization_ledger/)
  assert.match(workerSource, /Direct finalization processing is no longer supported/)
  assert.doesNotMatch(workerSource, /process_now:\s*true/)
  assert.doesNotMatch(workerSource, /workstation drain/i)
})
```

- [ ] **Step 2: Update operations docs**

In `D:/Coding/Website/docs/ICONOPLASM_OPERATIONS.md`, add a short section under the website sync section:

```markdown
### Finalization has one production path

Website Ops sync finalization has one path only:

`GUI Sync button -> workstation run-sync preflight -> durable D1 finalization ledger -> Cloudflare Queue drain_finalization_ledger -> geneguessr-api queue consumer -> /finalization/pending reaches zero`

Forbidden recovery paths:

- no workstation-side finalization processing
- no `/api/iconoplasm/admin/finalization/process`
- no direct Cloudflare Queue sends outside the worker
- no GitHub Actions Queue kick
- no compatibility shim that marks the run done without `/finalization/pending` reaching zero

If Queue send returns `429` or `QUEUE_SEND_FAILED`, the correct behavior is to fail loud before or during sync, preserve the durable ledger, and fix Cloudflare Queue allowance/account state. Re-running the GUI button without Queue headroom is not progress.
```

- [ ] **Step 3: Run guard tests**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Website'; npx tsx --test workers/iconoplasm.do-not-delete-cost-guards.test.js workers/iconoplasm.sync-finalization-queue.test.js }
if (-not (Wait-Job $job -Timeout 180)) { Stop-Job $job; throw 'worker guard tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'worker guard tests failed' }
```

Expected: PASS.

---

### Task 7: Final Verification Before Any Real Sync

**Files:**

- No code changes unless verification exposes a bug.

- [ ] **Step 1: Run static forbidden-path searches**

Run:

```powershell
rg -n "finalization/process|_remote_iconoplasm_process_finalization|process_finalization" D:\Coding\Iconoplasm\src D:\Coding\Iconoplasm\tests D:\Coding\Website\workers
```

Expected: only website worker tombstone tests and tombstone implementation remain. No workstation production call remains.

- [ ] **Step 2: Run protected D1 guard tests**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Website'; npx tsx --test workers/iconoplasm.d1-cost-barrier.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.do-not-delete-cost-guards.test.js }
if (-not (Wait-Job $job -Timeout 240)) { Stop-Job $job; throw 'protected D1 guard tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'protected D1 guard tests failed' }
```

Expected: PASS.

- [ ] **Step 3: Run targeted workstation tests**

Run:

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'D:\Coding\Iconoplasm'; .\.venv\Scripts\python.exe -m pytest tests/test_react_workstation_api.py -k "operations or finalization or website_sync or run_sync" -q }
if (-not (Wait-Job $job -Timeout 900)) { Stop-Job $job; throw 'targeted workstation tests timed out' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'targeted workstation tests failed' }
```

Expected: PASS.

- [ ] **Step 4: Do not run sync yet**

Stop after tests. The next step after this plan is implemented is a GUI preflight check, then one real GUI sync attempt only if:

- Queue kick preflight succeeds.
- Workers request guard has headroom.
- Durable Objects rows_written guard has headroom.
- D1 mutation limiter reports `d1_rows_written_daily_smart_limit`.
- The workstation code search proves no direct finalization processor remains.

---

## Self-Review

Spec coverage:

- Single true path: Tasks 1, 3, 4, and 6.
- Fail-loud design: Tasks 1, 2, 4, and 6.
- Zero legacy bloat: Tasks 3 and 5.
- No compatibility shims: Tasks 5 and 7.
- No actual sync run during planning/cleanup: Task 7.

Placeholder scan:

- No `TBD`, `TODO`, or “implement later” placeholders.
- All test and implementation steps include concrete code or concrete commands.

Type consistency:

- Workstation helper name is consistently `_remote_iconoplasm_kick_finalization_queue`.
- Worker Queue message kind is consistently `drain_finalization_ledger`.
- Forbidden route is consistently `/api/iconoplasm/admin/finalization/process`.
