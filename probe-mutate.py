import re
import sys

RT = "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
LEDGER = "workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
FAILED = []
CRLF = chr(13) + chr(10)
LF = chr(10)


def _read(path):
    with open(path, encoding="utf8", newline="") as handle:
        return handle.read().replace(CRLF, LF)


def _write(path, text):
    with open(path, "w", encoding="utf8", newline="") as handle:
        handle.write(text)


def rep(mid, path, old, new, count=1):
    text = _read(path)
    found = text.count(old)
    if found != count:
        print("MUTATION NOT APPLIED " + mid + ": " + str(found) + " matches of " + repr(old[:60]) + " in " + path)
        FAILED.append(mid)
        return
    _write(path, text.replace(old, new))
    print("mutation applied " + mid)


def rex(mid, path, pattern, new, count=1, flags=re.S):
    text = _read(path)
    result, found = re.subn(pattern, new, text, count=count, flags=flags)
    if found != count:
        print("MUTATION NOT APPLIED " + mid + ": " + str(found) + " regex matches of " + repr(pattern[:60]) + " in " + path)
        FAILED.append(mid)
        return
    _write(path, result)
    print("mutation applied " + mid)


def done():
    if FAILED:
        print("FAILED MUTATIONS: " + ", ".join(FAILED))
        sys.exit(1)

rep(
    "M30b-previews",
    RT,
    "const GENERATION_REQUEST_PUBLIC_PREVIEW_LIMIT = 4",
    "const GENERATION_REQUEST_PUBLIC_PREVIEW_LIMIT = 6",
)
done()
