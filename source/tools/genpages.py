"""Generates the desktop app HTML pages from small body templates (keeps heads identical)."""
import pathlib, sys
WEB = pathlib.Path(__file__).resolve().parent.parent / "engine" / "web"
SRC = pathlib.Path(__file__).resolve().parent / "pages"

HEAD = """<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} · Phalanx</title>
<link rel="icon" href="/img/icon.png" />
<link rel="stylesheet" href="/shared/palette.css" />
<link rel="stylesheet" href="/shared/ui.css" />
<link rel="stylesheet" href="/css/app.css" />
<script src="/shared/edition.js"></script>
<script src="/js/boot.js"></script>
</head>
<body{bodyattr}>
"""
FOOT = """<script src="/shared/intel.js"></script>
<script src="/shared/analysis.js"></script>
<script src="/shared/report-view.js"></script>
<script src="/js/charts.js"></script>
<script src="/js/app.js"></script>
<script src="/js/{js}.js"></script>
</body>
</html>
"""
for f in sorted(SRC.glob("*.html")):
    text = f.read_text(encoding="utf-8")
    first, body = text.split("\n", 1)
    meta = dict(kv.split("=", 1) for kv in first.strip("<!-> ").split(";"))
    out = HEAD.format(title=meta["title"], bodyattr=(' class="%s"' % meta["body"]) if meta.get("body") else "") + body + FOOT.format(js=meta["js"])
    (WEB / f.name).write_text(out, encoding="utf-8")
    print("wrote", f.name)
