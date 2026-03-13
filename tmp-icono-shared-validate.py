from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT = Path(r'D:\Coding\Website\public')
ICONO = ROOT / 'apps' / 'iconoplasm' / 'index.html'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?',1)[0].split('#',1)[0]
        rel = path.lstrip('/')
        return str((ROOT / rel).resolve())
    def do_GET(self):
        path = self.path.split('?',1)[0]
        if path in ('/', ''):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(ICONO.read_bytes())
            return
        return super().do_GET()
ThreadingHTTPServer(('127.0.0.1', 4100), Handler).serve_forever()
