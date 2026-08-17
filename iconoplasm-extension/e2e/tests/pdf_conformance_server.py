from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class RequestRecord:
    method: str
    path: str
    body_sha256: str


class PdfConformanceServer:
    def __init__(self, paper: Path) -> None:
        self.paper = paper.read_bytes()
        self.requests: list[RequestRecord] = []
        self._once_tokens: set[str] = set()
        self._lock = threading.Lock()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler_type())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def origin(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def __enter__(self) -> "PdfConformanceServer":
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._server.shutdown()
        self._thread.join(timeout=5)
        self._server.server_close()

    def count(self, path: str) -> int:
        with self._lock:
            return sum(record.path == path for record in self.requests)

    def write_ledger(self, path: Path) -> None:
        with self._lock:
            rows = [json.dumps(asdict(record), sort_keys=True) for record in self.requests]
        path.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")

    def _handler_type(self) -> type[BaseHTTPRequestHandler]:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
                self._dispatch(b"")

            def do_POST(self) -> None:  # noqa: N802 - stdlib callback name
                length = int(self.headers.get("Content-Length", "0"))
                self._dispatch(self.rfile.read(length))

            def _dispatch(self, body: bytes) -> None:
                route = urlsplit(self.path).path
                with owner._lock:
                    owner.requests.append(
                        RequestRecord(
                            method=self.command,
                            path=route,
                            body_sha256=hashlib.sha256(body).hexdigest(),
                        )
                    )

                if route == "/form/post.html":
                    self._html(
                        b'<!doctype html><form method="post" action="/pdf/post"><input name="case" value="post-pdf"><button type="submit">Open PDF</button></form>'
                    )
                    return
                if route == "/embed.html":
                    self._html(b'<!doctype html><iframe id="paper" src="/pdf/get.pdf"></iframe>')
                    return
                if route == "/pdf/post":
                    if self.command != "POST":
                        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
                        return
                    self._pdf(owner.paper)
                    return
                if route.startswith("/pdf/once/"):
                    token = route.rsplit("/", 1)[-1]
                    with owner._lock:
                        already_used = token in owner._once_tokens
                        owner._once_tokens.add(token)
                    if already_used:
                        self.send_error(HTTPStatus.GONE)
                        return
                    self._pdf(owner.paper)
                    return
                if route == "/pdf/attachment":
                    self._pdf(owner.paper, attachment=True)
                    return
                if route == "/pdf/range-partial":
                    partial = owner.paper[: min(1024, len(owner.paper))]
                    self.send_response(HTTPStatus.PARTIAL_CONTENT)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Range", f"bytes 0-{len(partial) - 1}/{len(owner.paper)}")
                    self.send_header("Content-Length", str(len(partial)))
                    self.end_headers()
                    self.wfile.write(partial)
                    return
                if route == "/pdf/wrong-mime":
                    self._bytes(owner.paper, "application/octet-stream")
                    return
                if route == "/pdf/get.pdf":
                    self._pdf(owner.paper)
                    return
                self.send_error(HTTPStatus.NOT_FOUND)

            def _html(self, body: bytes) -> None:
                self._bytes(body, "text/html; charset=utf-8")

            def _pdf(self, body: bytes, *, attachment: bool = False) -> None:
                extra = {"Content-Disposition": "attachment; filename=paper.pdf"} if attachment else {}
                self._bytes(body, "application/pdf", extra)

            def _bytes(self, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                for name, value in (extra or {}).items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)

        return Handler
