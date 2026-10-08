"""Record the demo video: type a few queries into the running search page and capture it to MP4.

Drives the installed Google Chrome (Playwright's own Chromium cannot play H.264), with a fresh
temporary profile. Frames come from Chrome's screencast at high JPEG quality, then ffmpeg
stitches them at their real timestamps into an H.264 MP4.

    uv run python scripts/serve.py ...            # in another terminal
    uv run python scripts/record_demo.py --out D:/moments/demo/demo-4x5.mp4 --size 1080x1350
"""

from __future__ import annotations

import argparse
import base64
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_QUERIES = [
    "a rocket lifting off",
    "astronauts on the Moon",
    "a hurricane seen from space",
    "a parachute opening over Mars",
]
TYPE_DELAY_MS = 55
HOLD_AFTER_RESULT_MS = 5500
OUTPUT_FPS = 30


def record(url: str, queries: list[str], width: int, height: int,
           frames_dir: Path) -> list[tuple[float, Path]]:
    frames: list[tuple[float, Path]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True,
                                    args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_context(viewport={"width": width, "height": height}).new_page()
        page.goto(url)
        page.wait_for_function("document.getElementById('stats').textContent.length > 0")
        page.wait_for_timeout(800)  # let web fonts settle before the first frame

        cdp = page.context.new_cdp_session(page)

        def on_frame(event: dict) -> None:
            path = frames_dir / f"{len(frames):06d}.jpg"
            path.write_bytes(base64.b64decode(event["data"]))
            frames.append((event["metadata"]["timestamp"], path))
            cdp.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})

        cdp.on("Page.screencastFrame", on_frame)
        cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": width,
                                          "maxHeight": height, "everyNthFrame": 1})
        page.wait_for_timeout(700)
        for query in queries:
            box = page.locator("#q")
            box.fill("")
            box.click()
            box.type(query, delay=TYPE_DELAY_MS)
            box.press("Enter")
            page.wait_for_function("document.querySelectorAll('.hit').length > 0 "
                                   "&& !document.getElementById('video').paused")
            page.wait_for_timeout(HOLD_AFTER_RESULT_MS)
        cdp.send("Page.stopScreencast")
        browser.close()
    return frames


def stitch(frames: list[tuple[float, Path]], out: Path) -> None:
    if len(frames) < 2:
        raise RuntimeError(f"only {len(frames)} frames captured")
    listing = frames[0][1].parent / "frames.txt"
    lines = []
    for (t, path), (t_next, _) in zip(frames, frames[1:], strict=False):
        lines += [f"file '{path.as_posix()}'", f"duration {max(t_next - t, 1 / OUTPUT_FPS):.4f}"]
    lines += [f"file '{frames[-1][1].as_posix()}'", "duration 1.0", f"file '{frames[-1][1].as_posix()}'"]
    listing.write_text("\n".join(lines), encoding="utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-vf", f"fps={OUTPUT_FPS},format=yuv420p", "-c:v", "libx264", "-crf", "16",
                    "-preset", "slow", "-movflags", "+faststart", str(out)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8780/")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--size", default="1080x1350", help="WIDTHxHEIGHT of the page, e.g. 1280x720")
    ap.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    args = ap.parse_args()
    width, height = (int(v) for v in args.size.lower().split("x"))

    tmp = Path(tempfile.mkdtemp(prefix="moments-rec-"))
    try:
        frames = record(args.url, args.queries, width, height, tmp)
        stitch(frames, args.out)
        span = frames[-1][0] - frames[0][0]
        print(f"{len(frames)} frames over {span:.1f} s -> {args.out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
