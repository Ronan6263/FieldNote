#!/usr/bin/env python3
"""Assemble index.html from src/ + vendor/. Run: python3 build.py"""
import pathlib
root = pathlib.Path(__file__).parent
read = lambda p: (root / p).read_text(encoding="utf-8")
body = read("src/body.html").replace("<!--ICONS-->", read("src/icons.svg").rstrip())
html = f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0d1117" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="FieldNote" />
  <meta name="format-detection" content="telephone=no" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" type="image/png" sizes="192x192" href="icon-192.png" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
  <title>FieldNote</title>
  <style>
{read("src/base.css")}
{read("src/app.css")}
  </style>
</head>
<body class="list-mode">
{body}
  <script>{read("vendor/pdf-lib.min.js")}
</script>
  <script>
{read("src/app.js")}
</script>
</body>
</html>
"""
(root / "index.html").write_text(html, encoding="utf-8")
print("index.html", len(html) // 1024, "KB")
