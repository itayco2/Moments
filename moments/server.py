"""A small local web server: the search page, a JSON search endpoint, thumbnails, and seekable video.

Binds to 127.0.0.1 only. Every file it serves is looked up by name in the index, never joined from
the request path, so a crafted URL cannot reach anything else on disk.
"""

from __future__ import annotations

import json
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, unquote, urlsplit

from moments.frames import duration_seconds
from moments.search import Index

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

STATIC = Path(__file__).parent / "static"
MAX_QUERY_CHARS = 200
MAX_K = 20
COPY_CHUNK = 1 << 20


class App:
    def __init__(self, index: Index, model: SentenceTransformer, footage: Path):
        self.index, self.model = index, model
        names = sorted({r["video"] for r in index.rows})
        self.videos = {n: footage / n for n in names if (footage / n).is_file()}
        self.thumbs = {r["thumb"]: index.folder / "thumbs" / r["thumb"] for r in index.rows}
        manifest = footage / "manifest.json"
        entries = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else []
        display = {e["file"]: e.get("display") for e in entries}
        self.catalog = {
            n: {"display": display.get(n) or Path(n).stem.replace("-", " ").title(),
                "duration": round(duration_seconds(p), 1)}
            for n, p in self.videos.items()
        }

    def search(self, query: str, k: int) -> dict:
        t0 = time.perf_counter()
        hits = self.index.search(self.index.embed_query(self.model, query), k)
        return {
            "query": query, "ms": round((time.perf_counter() - t0) * 1000),
            "hits": [{"video": h.video, "start": h.start, "end": h.end, "score": round(h.score, 4),
                      "thumb": f"/thumbs/{h.thumb}", **self.catalog.get(h.video, {})} for h in hits],
        }

    def about(self) -> dict:
        seconds = round(sum(v["duration"] for v in self.catalog.values()))
        return {"videos": len(self.catalog), "seconds": seconds,
                "moments": len(self.index.rows), "window_s": self.index.stats.get("window_s")}


def make_handler(app: App) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quiet: one line per search is enough
            pass

        def do_GET(self):  # noqa: N802 (stdlib name)
            url = urlsplit(self.path)
            route, _, name = url.path.partition("/")[2].partition("/")
            name = unquote(name)
            if url.path == "/":
                return self.send_file(STATIC / "index.html", "text/html; charset=utf-8")
            if route == "api" and name == "search":
                return self.api_search(parse_qs(url.query))
            if route == "api" and name == "about":
                return self.send_json(app.about())
            if route == "thumbs" and name in app.thumbs:
                return self.send_file(app.thumbs[name], "image/jpeg")
            if route == "video" and name in app.videos:
                return self.send_video(app.videos[name])
            self.send_error(HTTPStatus.NOT_FOUND)

        def api_search(self, params: dict) -> None:
            query = (params.get("q") or [""])[0].strip()
            if not query or len(query) > MAX_QUERY_CHARS:
                return self.send_json({"error": f"query must be 1-{MAX_QUERY_CHARS} characters"},
                                      HTTPStatus.BAD_REQUEST)
            try:
                k = min(max(int((params.get("k") or ["8"])[0]), 1), MAX_K)
            except ValueError:
                return self.send_json({"error": "k must be a number"}, HTTPStatus.BAD_REQUEST)
            result = app.search(query, k)
            top = result["hits"][0]["score"] if result["hits"] else "-"
            print(f"search {query!r}: {result['ms']} ms, top {top}", flush=True)
            self.send_json(result)

        def send_json(self, body: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def send_file(self, path: Path, ctype: str) -> None:
            data = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def send_video(self, path: Path) -> None:
            size = path.stat().st_size
            start, end = 0, size - 1
            ranged = self.headers.get("Range", "").startswith("bytes=")
            if ranged:
                first, _, last = self.headers["Range"][6:].split(",")[0].partition("-")
                try:
                    start = int(first) if first else max(size - int(last), 0)
                    end = min(int(last), size - 1) if first and last else end
                except ValueError:
                    return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                if start > end:
                    return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_response(HTTPStatus.PARTIAL_CONTENT if ranged else HTTPStatus.OK)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if ranged:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            remaining = end - start + 1
            try:
                with path.open("rb") as f:
                    f.seek(start)
                    while remaining > 0 and (chunk := f.read(min(COPY_CHUNK, remaining))):
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # the browser drops video connections whenever it seeks; that is normal

    return Handler


def serve(app: App, port: int) -> None:
    app.search("warm-up", 1)  # the first CUDA call pays a one-time ~1 s setup; pay it before anyone types
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    print(f"Moments on http://127.0.0.1:{port}  ({app.about()['moments']} moments indexed)", flush=True)
    server.serve_forever()
