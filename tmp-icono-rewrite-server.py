from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


ROOT = Path(r"D:/Coding/Website/public")
ICONO_INDEX = ROOT / "apps" / "iconoplasm" / "index.html"


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path == "/" or path.startswith("/gene/"):
            return str(ICONO_INDEX)
        clean = path.lstrip("/")
        return str((ROOT / clean).resolve())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


server = ThreadingHTTPServer(("127.0.0.1", 8093), Handler)
print("iconoplasm test server listening on http://127.0.0.1:8093", flush=True)
server.serve_forever()
