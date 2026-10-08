"""Start the search page.

    uv run python scripts/serve.py --index D:/moments/index/w8s4 --footage D:/moments/footage
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.model import load_model  # noqa: E402
from moments.search import Index  # noqa: E402
from moments.server import App, serve  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--footage", type=Path, required=True)
    ap.add_argument("--port", type=int, default=8780)
    args = ap.parse_args()
    serve(App(Index(args.index), load_model(), args.footage), args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
