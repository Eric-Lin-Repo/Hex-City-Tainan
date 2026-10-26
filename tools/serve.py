"""開發用靜態伺服器：關閉快取，改檔案後重新整理就是新版。用法：python3 -I tools/serve.py [port]"""
import http.server, os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
