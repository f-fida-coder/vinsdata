#!/usr/bin/env python3
"""One-off nginx patcher.

Inserts a /api/uploads/ direct-serve location block before the existing
/api/ rewrite block, so uploaded PDFs (BoS, JV) are served as static
files instead of being mapped to /api/uploads/<name>.pdf.php (which 404s).

Idempotent: skips if the block is already present.
"""
import sys

CONFIG_PATH = "/etc/nginx/sites-available/crm.vinvault.us"

NEW_BLOCK = """    # Static uploads (BoS PDFs, JV PDFs, attachments). MUST come before
    # the generic /api/ rewrite below, otherwise nginx maps the URL to
    # /api/uploads/foo.pdf.php and returns 404. Longest prefix wins.
    location ^~ /api/uploads/ {
        alias /var/www/crm/api/uploads/;
        try_files $uri =404;
        add_header Cache-Control "private, max-age=0";
    }

"""

ANCHOR = "    # API routes go to PHP. Strip the trailing slash + map /api/<name>\n"

with open(CONFIG_PATH, "r") as f:
    src = f.read()

if "/api/uploads/" in src:
    print("already-patched")
    sys.exit(0)

if ANCHOR not in src:
    print("anchor-not-found", file=sys.stderr)
    sys.exit(1)

patched = src.replace(ANCHOR, NEW_BLOCK + ANCHOR, 1)
with open(CONFIG_PATH, "w") as f:
    f.write(patched)
print("patched")
