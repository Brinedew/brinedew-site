#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Use this script when a user reports "portraits not loading on iconoplasm.brinedew.bio
for me, but the site is fine for everyone else" (or for most other people).

Public resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1, Adguard, etc.) will always
return NOERROR + a Bunny A record for iconoplasmportraits.b-cdn.net, because
Bunny's NS layer returns a wildcard A record for any *.b-cdn.net. So testing
from a public resolver will *never* reproduce the bug. The only way to
reproduce it is to query the *user's actual recursive resolver*.

On 2026-06-26, all four Vietnamese ISP resolvers below returned NXDOMAIN for
iconoplasmportraits.b-cdn.net. The bug was on the ISP's DNS layer, not on
Bunny, not on the project, not on a code change. The fix was waiting for the
ISP's negative cache to expire.

Usage:
  uv run --managed-python --script scripts/probe_isp_resolvers_for_iconoplasm_cdn.py
  # or, via the wrapper:
  scripts/check-isp-dns-self-heal.cmd   (Windows)

What "self-heal" means: ISP resolvers cache DNS answers. A stale negative
cache (NXDOMAIN) expires on its own per the SOA refresh / negative-cache TTL.
If the script starts showing NOERROR + A record on all four resolvers, the
bug is gone. If it stays NXDOMAIN after 3-5 days, the ISP has a sustained
policy block and the user should escalate to the ISP or accept the project-
side workaround.

DNS architecture (read this once, save hours next time):
  - iconoplasm.brinedew.bio is on Cloudflare authoritative DNS. Always resolves
    for everyone. This is the URL the worker's /portraits/ route serves at.
  - iconoplasmportraits.b-cdn.net is a Bunny pull zone. Bunny NS layer
    (ns1/2/3.bunnydns.com) returns a wildcard A record for any *.b-cdn.net.
  - The canonical URL at iconoplasm.brinedew.bio/portraits/... reads portrait
    bytes from Bunny's authenticated Storage API and is independently reachable
    through Cloudflare DNS.
  - The delivery policy may select the Bunny pull zone as an accelerator after
    one successful tab-wide probe. Resolver failure must select the canonical
    origin for that tab.

Resolve iconoplasmportraits.b-cdn.net via the EXACT ISP resolvers this Windows
host was using (2001:ee0:23::23, 2001:ee0:26::26, 123.23.23.23, 123.26.26.26).

Why: the Playwright session in this repo runs on this same Windows host and
fails with ERR_NAME_NOT_RESOLVED for the same hostname. If these ISP resolvers
also return NXDOMAIN/SERVFAIL, that's evidence the ISP changed filtering for
this hostname. If they return NOERROR + answer, the problem is on a different
network layer (proxy, IPv6 path, etc.).
"""
import argparse
import socket
import struct

DOMAIN = b"iconoplasmportraits.b-cdn.net"
RESOLVERS = [
    "2001:ee0:23::23",
    "2001:ee0:26::26",
    "123.23.23.23",
    "123.26.26.26",
]


def build_query(name: bytes, qtype: int = 1) -> bytes:
    """Build a DNS A query for `name`."""
    txid = 0x1234
    header = struct.pack(">HHHHHH", txid, 0x0100, 1, 0, 0, 0)  # RD=1
    qname = b""
    for label in name.rstrip(b".").split(b"."):
        qname += bytes([len(label)]) + label
    qname += b"\x00"
    question = qname + struct.pack(">HH", qtype, 1)
    return header + question


def parse_response(data: bytes):
    if len(data) < 12:
        return ("short", None, None, None, None)
    txid, flags, qd, an, ns, ar = struct.unpack(">HHHHHH", data[:12])
    rcode = flags & 0xF
    # skip question
    offset = 12
    for _ in range(qd):
        while data[offset] != 0:
            length = data[offset]
            if length & 0xC0:
                offset += 2
                break
            offset += 1 + length
        else:
            offset += 1
        offset += 4  # qtype + qclass
    answers = []
    for _ in range(an):
        # name (possibly compressed)
        if data[offset] & 0xC0:
            offset += 2
        else:
            while data[offset] != 0:
                offset += 1 + data[offset]
            offset += 1
        rtype, rclass, ttl, rdlen = struct.unpack(">HHIH", data[offset:offset + 10])
        offset += 10
        rdata = data[offset:offset + rdlen]
        offset += rdlen
        if rtype == 1 and rdlen == 4:
            answers.append(("A", socket.inet_ntoa(rdata), ttl))
        elif rtype == 28 and rdlen == 16:
            answers.append(("AAAA", socket.inet_ntop(socket.AF_INET6, rdata), ttl))
        else:
            answers.append((f"type{rtype}", rdata.hex(), ttl))
    return (rcode, qd, an, answers, "RD" if (flags & 0x100) else "no-RD")


def query(resolver: str, name: bytes, timeout: float = 5.0):
    """Send a single DNS A query to `resolver` and return the parsed response."""
    family = socket.AF_INET6 if ":" in resolver else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(build_query(name), (resolver, 53))
        data, _ = sock.recvfrom(4096)
        return parse_response(data)
    except socket.timeout:
        return ("timeout", None, None, None, None)
    except OSError as e:
        return (f"socket-err:{e}", None, None, None, None)
    finally:
        sock.close()


RCODE_NAMES = {
    0: "NOERROR",
    1: "FORMERR",
    2: "SERVFAIL",
    3: "NXDOMAIN",
    4: "NOTIMP",
    5: "REFUSED",
}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--timeout",
        type=float,
        default=5.0,
        help="Per-resolver UDP timeout in seconds (default: 5).",
    )
    parser.add_argument("--no-pause", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")

    for resolver in RESOLVERS:
        print(f"\n=== resolver {resolver} ===")
        rcode, qd, an, answers, flags = query(resolver, DOMAIN, timeout=args.timeout)
        if isinstance(rcode, int):
            rcname = RCODE_NAMES.get(rcode, f"rcode={rcode}")
            print(f"  rcode={rcname} ({rcode})  qd={qd} an={an}  flags={flags}")
            for record_type, value, ttl in answers or []:
                print(f"  answer: {record_type} {value} ttl={ttl}")
        else:
            print(f"  {rcode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
