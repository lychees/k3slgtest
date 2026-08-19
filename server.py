#!/usr/bin/env python3
# Static file server + JSON save API for the SoW tactics demo.
# Usage: python server.py [port]   (default 8931)
import http.server, socketserver, os, sys, json
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # 开发服务器: 禁用启发式缓存, 改文件后刷新即生效 (CDP 复用 profile 也不会拿到旧模块)
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == '/api/save':
            qs = parse_qs(u.query)
            rel = qs.get('path', [''])[0]
            # only allow writing inside data/
            norm = os.path.normpath(rel).replace('\\', '/')
            if not norm.startswith('data/') or '..' in norm:
                self.send_error(403, 'only data/ is writable')
                return
            n = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(n)
            try:
                json.loads(body)  # validate
            except Exception as e:
                self.send_error(400, f'invalid json: {e}')
                return
            dst = os.path.join(ROOT, norm)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as f:
                f.write(body)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            print(f'saved {norm} ({n} bytes)')
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):
        pass  # quiet

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'serving {ROOT} on http://localhost:{PORT}')
        httpd.serve_forever()
