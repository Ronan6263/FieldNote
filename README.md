# FieldNote

Drop in any fillable PDF and FieldNote lays out every field as a clean, phone-friendly form — text, dates, checkboxes, choices, dropdowns, photo and signature fields — then writes your answers back into the PDF.

- Reads AcroForm fields with [pdf-lib](https://pdf-lib.js.org/), labels them from the text next to each box, and groups them under the PDF's own section headings.
- Photo fields (take or choose a photo) and signature fields (finger/stylus pad) are stamped into the box on the PDF. Extra photos can be added as their own pages.
- Flat PDFs with no fields: tap the page to place text, date, check, photo or signature boxes by hand (labels are read from nearby text).
- Save a filled form as a **template** to reuse the layout.
- Works offline as an installable PWA. Everything stays on the device (IndexedDB) — nothing is uploaded.
- Same look as the Peroxide Log app: themes, Inter, collapsible tinted cards.

## Develop

`index.html` is generated. Edit `src/` and run:

```
python3 build.py
python3 -m http.server 8000
```

`src/base.css` is the shared design system, `src/app.css` / `src/app.js` / `src/body.html` are the app, `vendor/` holds pdf-lib and pdf.js.
