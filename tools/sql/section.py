#!/usr/bin/env python3
"""Print one `-- ==== I-n` section of a chunked SQL file (optionally as a rollback rehearsal)."""
import re, sys
path, sec = sys.argv[1], sys.argv[2]
rehearse = len(sys.argv) > 3 and sys.argv[3] == "rehearse"
s = open(path).read()
parts = re.split(r'^(?=-- ==== )', s, flags=re.M)
for p in parts:
    if p.startswith("-- ==== " + sec + " "):
        body = p.rstrip() + "\n"
        if rehearse:
            assert body.strip().endswith("commit;"), "rehearsal needs a commit-terminated section"
            body = body[: body.rstrip().rfind("commit;")] + "do $r$ begin raise exception 'REHEARSAL — rolled back'; end $r$;\ncommit;\n"
        print(body); sys.exit(0)
sys.exit("section not found")
