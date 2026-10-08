"""Download the demo footage from NASA's public video library (images.nasa.gov) and write a manifest.

Each entry is found by search query + title prefix, so the script survives NASA renaming files.
Downloads resume from a .part file and are checked against the server's Content-Length.

    uv run python scripts/fetch_footage.py --out D:/moments/footage
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://images-api.nasa.gov/search"
UA = {"User-Agent": "moments/0.1 (+github.com/itayco2)"}
CHUNK = 1 << 20
PREFERRED = ("~large.mp4", "~orig.mp4")

# (file stem, display name, search query, title prefix)
FOOTAGE = [
    ("earth-views", "Earth from the Space Station", "Earth views extended cut",
     "jsc2021m000138_4K_Earth_Views_Extended_Cut"),
    ("apollo-11", "Apollo 11", "Apollo 11 historical footage", "Video - Apollo 11 Historical Footage"),
    ("shuttle-final-launch", "The Last Shuttle Launch", "space shuttle launch",
     "NASA's Final Space Shuttle Launch 10th Anniversary"),
    ("iss-tour", "Inside the Space Station", "tour of the international space station",
     "Step Inside the International Space Station"),
    ("perseverance-landing", "Landing on Mars", "Perseverance rover",
     "NASA Provides First Front-Row Seat to Perseverance"),
    ("crew-dragon-tour", "Inside Crew Dragon", "tour of the international space station",
     "Tour from Space: Inside the SpaceX Crew Dragon"),
    ("all-woman-spacewalk", "First All-Woman Spacewalk", "spacewalk",
     "FIRST ALL-WOMAN SPACEWALK REPLACES FAULTY ELECTRICAL"),
]


def safe_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url.replace("http://", "https://"))
    return urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path)))


def get_json(url: str):
    with urllib.request.urlopen(urllib.request.Request(safe_url(url), headers=UA), timeout=60) as r:
        return json.load(r)


def resolve(query: str, title_prefix: str) -> dict:
    found = get_json(f"{API}?{urllib.parse.urlencode({'q': query, 'media_type': 'video', 'page_size': 50})}")
    for item in found["collection"]["items"]:
        meta = item["data"][0]
        if meta.get("title", "").startswith(title_prefix):
            assets = get_json(item["href"])
            url = next((a for suffix in PREFERRED for a in assets if a.endswith(suffix)), None)
            if url is None:
                raise RuntimeError(f"no mp4 for {meta['nasa_id']}")
            return {"nasa_id": meta["nasa_id"], "title": meta["title"],
                    "date": meta.get("date_created", "")[:10], "center": meta.get("center", ""),
                    "url": safe_url(url),
                    "page": safe_url(f"https://images.nasa.gov/details/{meta['nasa_id']}")}
    raise RuntimeError(f"no result titled {title_prefix!r} for query {query!r}")


def download(url: str, dest: Path) -> int:
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=60) as r:
        total = int(r.headers["Content-Length"])
    if dest.exists() and dest.stat().st_size == total:
        return total
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {**UA, "Range": f"bytes={have}-"} if have else UA
    started, last = time.perf_counter(), 0.0
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r, \
            part.open("ab" if have else "wb") as f:
        while chunk := r.read(CHUNK):
            f.write(chunk)
            have += len(chunk)
            now = time.perf_counter()
            if now - last > 15:
                rate = (have / 2**20) / max(now - started, 1e-9)
                done = f"{have / 2**20:.0f}/{total / 2**20:.0f} MiB"
                print(f"   {dest.name}: {done} ({rate:.1f} MiB/s)", flush=True)
                last = now
    if part.stat().st_size != total:
        raise RuntimeError(f"{dest.name}: got {part.stat().st_size} bytes, expected {total}")
    part.replace(dest)
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    manifest = []
    for name, display, query, prefix in FOOTAGE:
        entry = {"file": f"{name}.mp4", "display": display, **resolve(query, prefix)}
        print(f"-> {entry['file']}: {entry['title']}", flush=True)
        entry["bytes"] = download(entry["url"], args.out / entry["file"])
        manifest.append(entry)
        (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"done: {len(manifest)} files, {sum(e['bytes'] for e in manifest) / 2**30:.2f} GiB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
