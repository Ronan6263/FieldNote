"use strict";
/* =====================================================================
   FieldNote — turn any fillable PDF into a clean mobile form, then
   write the answers (text, checks, photos, signatures) back into it.
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const icon = (id, cls = "ico sm") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const TEXT_KINDS = ["text", "multiline", "date", "email", "tel", "number"];
const COMPACT = new Set(["text", "date", "email", "tel", "number", "select"]);
const KIND_NAMES = {
  text: "Short text", multiline: "Long text", date: "Date", email: "Email", tel: "Phone", number: "Number",
  check: "Checkbox", radio: "Choice (one)", select: "Dropdown", multi: "Choice (many)", photo: "Photo", signature: "Signature"
};

// ------------------------------------------------------------- state + storage
const S = { docs: [], prefs: { theme: "dark", calm: false, dateFmt: "MM/dd/yyyy" }, activeId: null, editing: false, listMode: true };
const PREF_KEY = "fieldnote.prefs.v1";
let idb = null;
const memStore = new Map();

function loadPrefs() {
  try { Object.assign(S.prefs, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch (e) {}
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(S.prefs)); } catch (e) {} }

function openDb() {
  return new Promise((res) => {
    setTimeout(() => res(null), 2500); // some sandboxed previews never answer
    try {
      const r = indexedDB.open("fieldnote", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
function dbReq(mode, fn) {
  return new Promise((res, rej) => {
    if (!idb) { res(fn(null)); return; }
    const guard = setTimeout(() => rej(new Error("storage timeout")), 10000);
    try {
      const tx = idb.transaction("docs", mode);
      const st = tx.objectStore("docs");
      const rq = fn(st);
      tx.oncomplete = () => { clearTimeout(guard); res(rq && rq.result); };
      tx.onerror = () => { clearTimeout(guard); rej(tx.error); };
      tx.onabort = () => { clearTimeout(guard); rej(tx.error); };
    } catch (e) { clearTimeout(guard); rej(e); }
  });
}
const dbAll = () => idb ? dbReq("readonly", (st) => st.getAll()) : Promise.resolve([...memStore.values()]);
const dbPut = (doc) => idb ? dbReq("readwrite", (st) => st.put(doc)) : (memStore.set(doc.id, doc), Promise.resolve());
const dbDel = (id) => idb ? dbReq("readwrite", (st) => st.delete(id)) : (memStore.delete(id), Promise.resolve());

let saveT = 0, saveInflight = 0;
const dirty = new Set();
function setSaveUi(kind) {
  const el = $("saveState");
  if (!el) return;
  el.classList.toggle("saving", kind === "saving");
  el.classList.toggle("error", kind === "error");
  $("saveText").textContent = kind === "saving" ? "Saving…" : kind === "error" ? "Not saved" : "Saved";
}
function touch(doc) {
  doc.updatedAt = Date.now();
  dirty.add(doc.id);
  setSaveUi("saving");
  clearTimeout(saveT);
  saveT = setTimeout(flushSaves, 450);
}
async function flushSaves() {
  clearTimeout(saveT);
  const ids = [...dirty];
  dirty.clear();
  try {
    for (const id of ids) {
      const d = S.docs.find((x) => x.id === id);
      if (d) await dbPut(d);
    }
    setSaveUi("ok");
  } catch (e) {
    console.error(e);
    setSaveUi("error");
    toast("Couldn't save – storage may be full");
  }
}
window.addEventListener("pagehide", () => { if (dirty.size) flushSaves(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && dirty.size) flushSaves(); });

function activeDoc() { return S.docs.find((d) => d.id === S.activeId) || null; }

// ------------------------------------------------------------- toast, sheets, busy
function toast(msg, actionLabel, action) {
  const el = $("toast");
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  el.classList.toggle("has-action", !!action);
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-action"; b.textContent = actionLabel;
    b.addEventListener("click", () => { el.classList.remove("show", "has-action"); clearTimeout(toast._t); action(); });
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show", "has-action"), action ? 5500 : 2200);
}
function openSheet(id) {
  const back = $(id.replace("Sheet", "Back"));
  if (back) back.classList.add("show");
  $(id).classList.add("show");
}
function closeSheet(id) {
  const back = $(id.replace("Sheet", "Back"));
  if (back) back.classList.remove("show");
  $(id).classList.remove("show");
}
function busy(msg) {
  let b = $("busy");
  if (!b) {
    b = document.createElement("div");
    b.id = "busy"; b.className = "busy";
    b.innerHTML = "<div></div>";
    document.body.appendChild(b);
  }
  clearTimeout(busy._t);
  if (msg) { b.firstChild.textContent = msg; b.classList.add("show"); busy._t = setTimeout(() => b.classList.remove("show"), 40000); } else b.classList.remove("show");
}

// ------------------------------------------------------------- themes (same system as h202)
const THEMES = [
  { id: "auto",     name: "Auto",      note: "Follows phone", bar: "#0d1117", swatch: ["linear-gradient(135deg,#f2f4f7 0 50%,#0d1117 50% 100%)", "rgba(138,148,163,.45)", "#2aa8bb", "#8b95a4"] },
  { id: "dark",     name: "Midnight",  note: "Default dark",  bar: "#0d1117", swatch: ["#0d1117", "#1b222d", "#4cc9d9", "#e6eaf0"] },
  { id: "graphite", name: "Graphite",  note: "True black",    bar: "#0a0a0b", swatch: ["#0a0a0b", "#1a1a1d", "#a4b6ff", "#ececee"] },
  { id: "harbor",   name: "Harbor",    note: "Deep navy",     bar: "#0a1424", swatch: ["#0a1424", "#142744", "#66b8ff", "#e3ecf8"] },
  { id: "forest",   name: "Forest",    note: "Low glare",     bar: "#0b120f", swatch: ["#0b120f", "#18231e", "#7dd3a8", "#e3ece6"] },
  { id: "light",    name: "Daylight",  note: "Clean light",   bar: "#f2f4f7", swatch: ["#f2f4f7", "#ffffff", "#0e8196", "#131a23"] },
  { id: "sand",     name: "Sandstone", note: "Warm paper",    bar: "#f2eee7", swatch: ["#f2eee7", "#fffdf9", "#2f7264", "#221d17"] },
  { id: "sun",      name: "Sunlight",  note: "Max contrast",  bar: "#ffffff", swatch: ["#ffffff", "#f3f5f8", "#0047b3", "#000000"] }
];
const DARK_MQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const resolveTheme = (id) => id === "auto" ? (DARK_MQ && DARK_MQ.matches ? "dark" : "light") : id;
function renderThemeGrid() {
  $("themeGrid").innerHTML = THEMES.map((t) => `
    <button type="button" class="theme-card" data-theme-pick="${t.id}" role="radio" aria-label="${t.name} theme">
      <span class="theme-swatch" style="--s-bg:${t.swatch[0]};--s-panel:${t.swatch[1]};--s-accent:${t.swatch[2]};--s-text:${t.swatch[3]}">
        <span class="ts-card"><i class="ts-line l1"></i><i class="ts-line l2"></i></span>
        <span class="ts-btn"></span>
        <span class="ts-check">${icon("check", "ico")}</span>
      </span>
      <span class="theme-name">${t.name}</span><span class="theme-note">${t.note}</span>
    </button>`).join("");
}
function applyTheme(name, save) {
  const pick = THEMES.find((x) => x.id === name) || THEMES[1];
  const real = THEMES.find((x) => x.id === resolveTheme(pick.id)) || pick;
  applyTheme._pick = pick.id;
  const paint = () => {
    document.documentElement.dataset.theme = real.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = real.bar;
  };
  const calm = document.documentElement.classList.contains("calm") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (save && document.startViewTransition && !calm && document.documentElement.dataset.theme !== real.id) {
    try { document.startViewTransition(paint); } catch (e) { paint(); }
  } else paint();
  document.querySelectorAll("[data-theme-pick]").forEach((btn) => {
    const on = btn.dataset.themePick === pick.id;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
  if (save) { S.prefs.theme = pick.id; savePrefs(); }
}
if (DARK_MQ) {
  const onScheme = () => { if (applyTheme._pick === "auto") applyTheme("auto", false); };
  if (DARK_MQ.addEventListener) DARK_MQ.addEventListener("change", onScheme);
}
function applyMotion() {
  document.documentElement.classList.toggle("calm", !!S.prefs.calm);
  const b = $("motionToggle");
  b.classList.toggle("on", !!S.prefs.calm);
  b.setAttribute("aria-checked", S.prefs.calm ? "true" : "false");
  b.textContent = S.prefs.calm ? "ON" : "OFF";
}
function setSwitch(btn, on, yes = "YES", no = "NO") {
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
  btn.textContent = on ? yes : no;
}

// ------------------------------------------------------------- dates
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatDate(iso, fmt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return String(iso || "");
  const y = +m[1], mo = +m[2], d = +m[3];
  const p2 = (n) => String(n).padStart(2, "0");
  return String(fmt || "MM/dd/yyyy").replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d/g, (t) => ({
    yyyy: y, yy: p2(y % 100), MMMM: MONTHS[mo - 1], MMM: MONTHS[mo - 1].slice(0, 3), MM: p2(mo), M: mo, dd: p2(d), d: d
  }[t]));
}
const AF_DATE_FORMATS = ["m/d", "m/d/yy", "mm/dd/yy", "mm/yy", "d-mmm", "d-mmm-yy", "dd-mmm-yy", "yy-mm-dd", "mmm-yy", "mmmm-yy", "mmm d, yyyy", "mmmm d, yyyy"];
function acroToFmt(s) {
  return String(s).toLowerCase().replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (t) => ({ yyyy: "yyyy", yy: "yy", mmmm: "MMMM", mmm: "MMM", mm: "MM", m: "M", dd: "dd", d: "d" }[t]));
}

// ------------------------------------------------------------- PDF analysis
function pdfBytesToDataUrlSafe(u8) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function jsActionText(dicts) {
  const L = PDFLib;
  for (const d of dicts) {
    try {
      const aa = d.lookup(L.PDFName.of("AA"));
      if (!(aa instanceof L.PDFDict)) continue;
      const fa = aa.lookup(L.PDFName.of("F"));
      if (!(fa instanceof L.PDFDict)) continue;
      const js = fa.lookup(L.PDFName.of("JS"));
      if (!js) continue;
      if (typeof js.decodeText === "function") return js.decodeText();
      if (js.contents) return new TextDecoder("latin1").decode(L.decodePDFRawStream(js).decode());
    } catch (e) {}
  }
  return "";
}
function humanize(name) {
  let n = String(name || "").split(".").pop().replace(/\[\d+\]/g, "").replace(/[_ ]af[_ ]image$/i, "");
  n = n.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}
const GENERIC_NAME = /^(text|field|textfield|check ?box|checkbox|radio( button| group)?|button|drop ?down|combo( box)?|list( box)?|f|fld|tf|cb|chk|rb|img|image field|untitled|signature)[ _\-]?\d*$|^[a-z]{1,2}\d*[ _]?\d+$/i;
const IMAGE_NAME = /photo|image|picture|img|logo|headshot|attach|\bpic\b/i;

function guessTextKind(fd, js) {
  const hint = (fd.name + " " + (fd.label || "")).toLowerCase();
  if (/AFDate_FormatEx\(\s*["']([^"']+)["']/.test(js)) { fd.dateFmt = acroToFmt(RegExp.$1); return "date"; }
  const m = /AFDate_Format\(\s*(\d+)/.exec(js);
  if (m && AF_DATE_FORMATS[+m[1]]) { fd.dateFmt = acroToFmt(AF_DATE_FORMATS[+m[1]]); return "date"; }
  if (/AFNumber_Format|AFPercent_Format/.test(js)) return "number";
  const sp = /AFSpecial_Format\(\s*(\d+)/.exec(js);
  if (sp) return sp[1] === "2" ? "tel" : "text";
  if (/(^|[^a-z])e-?mail([^a-z]|$)/.test(hint)) return "email";
  if (/(^|[^a-z])(phone|tel|telephone|mobile|cell|fax)([^a-z]|$)/.test(hint)) return "tel";
  if (/(^|[^a-z])(date|dob|birth ?date|date of birth)([^a-z]|$)/.test(hint) && !fd.maxLength) return "date";
  if (/signature/.test(hint) && !fd.multiline) return "signature";
  return fd.multiline ? "multiline" : "text";
}

async function analyzePdf(bytes) {
  const L = PDFLib;
  const pdf = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pdfPages = pdf.getPages();
  const pages = pdfPages.map((p) => { const s = p.getSize(); return { w: s.width, h: s.height, rot: p.getRotation().angle }; });
  const annotPage = new Map();
  pdfPages.forEach((pg, i) => {
    try {
      const an = pg.node.Annots();
      if (!an) return;
      for (let k = 0; k < an.size(); k++) { const o = an.lookup(k); if (o) annotPage.set(o, i); }
    } catch (e) {}
  });
  let form = null, all = [];
  try { form = pdf.getForm(); all = form.getFields(); } catch (e) { all = []; }
  const fields = [];
  const skipped = { readOnly: 0, buttons: 0 };
  all.forEach((f) => {
    try {
      const name = f.getName();
      let widgets = [];
      try { widgets = f.acroField.getWidgets(); } catch (e) {}
      const rects = [];
      let imageIcon = false;
      widgets.forEach((w) => {
        try {
          const fl = w.dict.lookup(L.PDFName.of("F"));
          const flags = fl && fl.asNumber ? fl.asNumber() : 0;
          if (flags & 2 || flags & 32) return; // hidden / no-view
          const r = w.getRectangle();
          const mk = w.dict.lookup(L.PDFName.of("MK"));
          if (mk instanceof L.PDFDict) {
            const tp = mk.lookup(L.PDFName.of("TP"));
            if (tp && tp.asNumber && tp.asNumber() === 1) imageIcon = true;
          }
          let opt = "";
          if (f instanceof L.PDFRadioGroup) {
            try {
              const opts = f.getOptions();
              opt = opts.length === widgets.length ? opts[widgets.indexOf(w)] : (w.getOnValue() ? w.getOnValue().decodeText() : "");
            } catch (e) {}
          }
          const pg = annotPage.has(w.dict) ? annotPage.get(w.dict) : 0;
          rects.push({ x: r.x, y: r.y, w: r.width, h: r.height, page: pg, opt });
        } catch (e) {}
      });
      if (!rects.length) return;
      if (f.isReadOnly && f.isReadOnly()) { skipped.readOnly++; return; }
      const fd = {
        id: "f" + fields.length, name, kind: "text", origin: "text", label: "", hint: "", group: "",
        page: rects[0].page, rects, options: [], optLabels: {}, required: !!(f.isRequired && f.isRequired()), hidden: false,
        maxLength: 0, multiline: false, defaultValue: null
      };
      const dicts = [f.acroField.dict].concat(widgets.map((w) => w.dict));
      if (f instanceof L.PDFTextField) {
        fd.multiline = !!f.isMultiline();
        fd.maxLength = f.getMaxLength() || 0;
        fd.defaultValue = f.getText() || "";
        fd.jsFmt = jsActionText(dicts);
        fd.kind = guessTextKind(fd, fd.jsFmt);
        if (fd.kind === "date") fd.defaultValue = "";
      } else if (f instanceof L.PDFCheckBox) {
        fd.kind = fd.origin = "check";
        fd.defaultValue = !!f.isChecked();
      } else if (f instanceof L.PDFRadioGroup) {
        fd.kind = fd.origin = "radio";
        fd.options = f.getOptions();
        fd.defaultValue = f.getSelected() || "";
      } else if (f instanceof L.PDFDropdown) {
        fd.kind = fd.origin = "select";
        fd.options = f.getOptions();
        fd.defaultValue = (f.getSelected() || [])[0] || "";
      } else if (f instanceof L.PDFOptionList) {
        fd.kind = fd.origin = f.isMultiselect() ? "multi" : "select";
        fd.options = f.getOptions();
        fd.defaultValue = f.isMultiselect() ? (f.getSelected() || []) : ((f.getSelected() || [])[0] || "");
      } else if (f instanceof L.PDFSignature) {
        fd.kind = fd.origin = "signature";
      } else if (f instanceof L.PDFButton) {
        if (imageIcon || IMAGE_NAME.test(name)) { fd.kind = fd.origin = "photo"; }
        else { skipped.buttons++; return; }
      } else return;
      fields.push(fd);
    } catch (e) { console.warn("field skipped", e); }
  });
  fields.forEach((f, i) => (f.id = "f" + i));
  return { pages, fields, skipped, hasForm: fields.length > 0 };
}

// --- pdf.js: used for reading nearby text (labels, headings) and for previews
let pdfjsPromise = null;
const PDFJS_SOURCES = [
  { lib: "vendor/pdf.min.js", worker: "vendor/pdf.worker.min.js", fonts: "vendor/standard_fonts/" },
  { lib: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js", worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js", fonts: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/" }
];
let pdfjsFonts = PDFJS_SOURCES[0].fonts;
function loadScript(src, ms) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const t = setTimeout(() => { s.remove(); reject(new Error("timeout " + src)); }, ms);
    s.src = src;
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error("failed " + src)); };
    document.head.appendChild(s);
  });
}
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    let lastErr;
    for (const src of PDFJS_SOURCES) {
      try {
        await loadScript(src.lib, 7000);
        pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
        pdfjsFonts = src.fonts;
        return window.pdfjsLib;
      } catch (e) { lastErr = e; }
    }
    pdfjsPromise = null;
    throw lastErr || new Error("pdf.js unavailable");
  })();
  return pdfjsPromise;
}
const pdfjsOpts = () => ({ standardFontDataUrl: pdfjsFonts, isEvalSupported: false });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + " timed out")), ms))]);

function buildPhrases(items) {
  const raw = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10, bold: /bold|black|heavy|semibold/i.test(it.fontName || "") }))
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
  const out = [];
  for (const it of raw) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, it.h * 0.4) && it.x - last.xEnd < Math.max(it.h * 0.9, 4) && it.x >= last.x) {
      const gap = it.x - last.xEnd;
      last.str += (gap > it.h * 0.15 && !/\s$/.test(last.str) && !/^\s/.test(it.str) ? " " : "") + it.str;
      last.xEnd = it.x + it.w;
      last.h = Math.max(last.h, it.h);
      last.bold = last.bold && it.bold;
    } else out.push({ str: it.str, x: it.x, xEnd: it.x + it.w, y: it.y, h: it.h, bold: it.bold });
  }
  return out;
}
function cleanLabel(s) {
  s = String(s || "").replace(/_{2,}.*$/, "").replace(/\s+/g, " ").replace(/^[\s*•·\-–—:.]+|[\s*:.\-–—_]+$/g, "").trim();
  if (s.length < 2 || s.length > 80 || !/[A-Za-z]/.test(s)) return "";
  return s;
}
function titleCaseIfShouting(s) {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return s.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return s;
}
function findLabel(r, phrases, side) {
  const midY = r.y + r.h / 2;
  let best = null, bestScore = 1e9;
  for (const p of phrases) {
    if (p.str.length > 90) continue;
    let score = null;
    if (side === "right") {
      const dx = p.x - (r.x + r.w);
      if (dx > -3 && dx < 26 && Math.abs(p.y + p.h * 0.3 - midY) < Math.max(8, r.h * 0.8)) score = dx;
    } else {
      const dxL = r.x - p.xEnd;
      if (dxL > -3 && dxL < 280 && Math.abs(p.y + p.h * 0.3 - midY) < Math.max(9, r.h * 0.7)) score = dxL;
      const dyU = p.y - (r.y + r.h);
      if (dyU > -3 && dyU < 28 && p.x < r.x + r.w - 2 && p.xEnd > r.x + 2 && (score === null || dxL > 150)) score = Math.min(score === null ? 1e9 : score, dyU * 2 + 60);
    }
    if (score !== null && score < bestScore) { best = p; bestScore = score; }
  }
  return best ? cleanLabel(best.str) : "";
}
async function labelFields(bytes, info) {
  const lib = await loadPdfJs();
  const task = lib.getDocument(Object.assign({ data: bytes.slice() }, pdfjsOpts()));
  const pdf = await task.promise;
  try {
    const perPage = [];
    for (let i = 0; i < info.pages.length; i++) {
      const pg = await pdf.getPage(i + 1);
      const tc = await pg.getTextContent();
      perPage.push(buildPhrases(tc.items));
    }
    const byPage = new Map();
    info.fields.forEach((f) => { (byPage.get(f.page) || byPage.set(f.page, []).get(f.page)).push(f); });
    byPage.forEach((fs, pageIdx) => {
      const phrases = perPage[pageIdx] || [];
      const hs = phrases.map((p) => p.h).sort((a, b) => a - b);
      const med = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
      const allRects = [];
      fs.forEach((f) => f.rects.forEach((r) => allRects.push(r)));
      // section headings: noticeably larger or bold-caps text that has no field beside it
      const heads = phrases.filter((p) => {
        const s = p.str.trim();
        if (s.length < 3 || s.length > 70 || /[:_]$/.test(s) || !/[A-Za-z]{3}/.test(s)) return false;
        const big = p.h >= med * 1.18;
        const boldCaps = p.bold && p.h >= med * 0.95 && s === s.toUpperCase();
        if (!big && !boldCaps) return false;
        return !allRects.some((rc) => Math.abs(p.y + p.h * 0.3 - (rc.y + rc.h / 2)) < Math.max(8, rc.h) && rc.x - p.xEnd > -2 && rc.x - p.xEnd < 220);
      }).sort((a, b) => b.y - a.y);
      const headSet = new Set(heads);
      const cand = phrases.filter((p) => !headSet.has(p));
      fs.forEach((f) => {
        const r = f.rects[0];
        if (f.origin === "check") {
          const t = findLabel(r, cand, "right") || findLabel(r, cand, "left");
          if (t) f.label = t;
        } else if (f.origin === "radio") {
          f.rects.forEach((rc) => { const t = findLabel(rc, cand, "right"); if (t && rc.opt) f.optLabels[rc.opt] = t; });
          const rr = { x: Math.min(...f.rects.map((q) => q.x)), y: Math.max(...f.rects.map((q) => q.y + q.h)) - 1, w: Math.max(...f.rects.map((q) => q.x + q.w)) - Math.min(...f.rects.map((q) => q.x)), h: 1 };
          f.label = findLabel(rr, cand, "left") || "";
        } else {
          f.label = findLabel(r, cand, "left");
        }
      });
      fs.forEach((f) => { if (f.label) f.label = titleCaseIfShouting(f.label); });
      if (heads.length >= 2 || (heads.length === 1 && fs.length > 6)) {
        fs.forEach((f) => {
          const top = f.rects[0].y + f.rects[0].h;
          const h = heads.find((hh) => hh.y >= top - 2);
          let cand = null;
          for (const hh of heads) if (hh.y >= top - 2) cand = hh;
          f.group = cand ? titleCaseIfShouting(cleanLabel(cand.str) || cand.str.trim()) : "";
          void h;
        });
      }
    });
  } finally {
    try { pdf.destroy(); } catch (e) {}
  }
}

function finalizeFields(info) {
  // order: page, top to bottom, left to right
  const sorted = info.fields.slice().sort((a, b) => a.page - b.page || (Math.abs(b.rects[0].y - a.rects[0].y) > 6 ? b.rects[0].y - a.rects[0].y : a.rects[0].x - b.rects[0].x));
  const perPageCount = {};
  sorted.forEach((f, i) => {
    f.order = i;
    if (f.origin === "text" && (f.kind === "text" || f.kind === "multiline")) f.kind = guessTextKind(f, f.jsFmt || "");
    if (f.kind === "date") f.defaultValue = "";
    delete f.jsFmt;
    perPageCount[f.page] = (perPageCount[f.page] || 0) + 1;
    if (!f.label) {
      const h = humanize(f.name);
      f.label = h && !GENERIC_NAME.test(h) && !GENERIC_NAME.test(f.name.split(".").pop().replace(/\[\d+\]/g, "")) ? h : `${KIND_NAMES[f.kind] === "Checkbox" ? "Checkbox" : f.kind === "photo" ? "Photo" : f.kind === "signature" ? "Signature" : "Field"} ${perPageCount[f.page]}`;
    }
  });
  info.fields = sorted;
  return info;
}

// ------------------------------------------------------------- documents
function prettyName(fileName) {
  return String(fileName || "Untitled").replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}
async function createDocFromPdf(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const info = await analyzePdf(buf);
  try { if (info.fields.length) await withTimeout(labelFields(buf, info), 20000, "Label pass"); } catch (e) { console.warn("label pass failed", e); }
  finalizeFields(info);
  const doc = {
    id: uid(), name: prettyName(file.name), createdAt: Date.now(), updatedAt: Date.now(), isTemplate: false,
    pdf: buf, pages: info.pages, fields: info.fields, values: {}, attachments: [], flatten: false, skipped: info.skipped
  };
  info.fields.forEach((f) => {
    if (f.defaultValue !== null && f.defaultValue !== "" && !(Array.isArray(f.defaultValue) && !f.defaultValue.length) && f.defaultValue !== false) doc.values[f.id] = f.defaultValue;
  });
  S.docs.unshift(doc);
  await dbPut(doc);
  return doc;
}

// ------------------------------------------------------------- list screen
function answerable(doc) { return doc.fields.filter((f) => !f.hidden && f.kind !== "check"); }
function isFilled(doc, f) {
  const v = doc.values[f.id];
  return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
}
function progress(doc) {
  const list = answerable(doc);
  const done = list.filter((f) => isFilled(doc, f)).length;
  return { done, total: list.length, frac: list.length ? done / list.length : 0 };
}
function ringHtml(frac, label, cls) {
  const C = 2 * Math.PI * 18;
  return `<span class="doc-ring ${cls || ""}"><svg viewBox="0 0 44 44"><circle class="rt" cx="22" cy="22" r="18"/><circle class="rf" cx="22" cy="22" r="18" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/></svg><i>${label}</i></span>`;
}
function relTime(ts) {
  const d = new Date(ts), now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
function docRow(doc) {
  const p = progress(doc);
  const pct = Math.round(p.frac * 100);
  const pages = doc.pages.length;
  const meta = doc.isTemplate
    ? `${pages} page${pages === 1 ? "" : "s"} · ${doc.fields.filter((f) => !f.hidden).length} fields`
    : `${p.total ? `${p.done} of ${p.total} answered` : "No fields"} · ${relTime(doc.updatedAt)}`;
  return `<div class="doc-row" data-open="${doc.id}" role="button" tabindex="0">
    ${doc.isTemplate ? ringHtml(1, icon("bookmark", "ico sm"), "tpl") : ringHtml(p.frac, p.total ? pct + "" : "–", p.total && p.done === p.total ? "done" : "")}
    <span style="min-width:0"><div class="doc-name">${escapeHtml(doc.name)}</div><div class="doc-meta">${doc.isTemplate ? '<span class="tpl-tag">Template</span>' : ""}${escapeHtml(meta)}</div></span>
    <button type="button" class="doc-dots" data-doc-menu="${doc.id}" aria-label="More for ${escapeHtml(doc.name)}">${icon("more", "ico")}</button>
  </div>`;
}
function renderList() {
  const q = ($("docSearch").value || "").trim().toLowerCase();
  const match = (d) => !q || d.name.toLowerCase().includes(q);
  const forms = S.docs.filter((d) => !d.isTemplate && match(d)).sort((a, b) => b.updatedAt - a.updatedAt);
  const tpls = S.docs.filter((d) => d.isTemplate && match(d)).sort((a, b) => b.updatedAt - a.updatedAt);
  const totalForms = S.docs.filter((d) => !d.isTemplate).length;
  $("homeCount").textContent = S.docs.length ? `${totalForms} form${totalForms === 1 ? "" : "s"}${S.docs.some((d) => d.isTemplate) ? ` · ${S.docs.filter((d) => d.isTemplate).length} template${S.docs.filter((d) => d.isTemplate).length === 1 ? "" : "s"}` : ""}` : "Add a PDF to get started";
  $("homeTools").classList.toggle("hidden", S.docs.length < 4);
  let html = "";
  if (!S.docs.length) {
    html = `<div class="fn-empty">
      <svg viewBox="0 0 140 110" fill="none" aria-hidden="true"><rect x="38" y="8" width="64" height="86" rx="9" fill="currentColor" fill-opacity=".10" stroke="currentColor" stroke-width="2.4"/><path d="M50 30h40M50 44h40M50 58h24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="98" cy="84" r="17" fill="currentColor"/><path d="M91 84h14M98 77v14" stroke="var(--on-accent)" stroke-width="3" stroke-linecap="round"/></svg>
      <h3>Any PDF becomes a form</h3>
      <p>Pick a fillable PDF and FieldNote lays out every field top to bottom, with photo and signature fields too. Then it writes your answers straight back into the PDF.</p>
    </div>
    <div class="drop" id="dropZone">Or drop a PDF here</div>`;
  } else {
    if (forms.length) html += `<h3 class="group-label">Forms</h3><div class="list-group">${forms.map(docRow).join("")}</div>`;
    if (tpls.length) html += `<h3 class="group-label">Templates</h3><div class="list-group">${tpls.map(docRow).join("")}</div><p class="swipe-hint" style="margin-top:8px">Tap a template to start a new form from it.</p>`;
    if (!forms.length && !tpls.length) html = `<div class="empty">Nothing matches “${escapeHtml(q)}”.</div>`;
  }
  $("homeList").innerHTML = html;
}

// ------------------------------------------------------------- editor: layout + render
function groupCards(doc) {
  const cards = new Map();
  doc.fields.forEach((f) => {
    if (f.hidden && !S.editing) return;
    const key = f.page + "|" + (f.group || "");
    if (!cards.has(key)) cards.set(key, { key, page: f.page, group: f.group || "", title: f.group || `Page ${f.page + 1}`, fields: [] });
    cards.get(key).fields.push(f);
  });
  const list = [...cards.values()];
  list.forEach((c, i) => (c.id = "card_" + i));
  return list;
}
function fieldHtml(doc, f) {
  const v = doc.values[f.id];
  const id = "in_" + f.id;
  const req = f.required ? `<span class="req" aria-hidden="true">*</span>` : "";
  const cls = "fn-field" + (f.hidden ? " off" : "");
  const edit = `<button type="button" class="fn-edit" data-edit="${f.id}">${icon("pencil", "ico sm")}Edit</button>`;
  const hint = f.hint ? `<p class="field-hint">${escapeHtml(f.hint)}</p>` : "";
  const label = `<label for="${id}">${escapeHtml(f.label)}${req}</label>`;
  switch (f.kind) {
    case "multiline":
      return `<div class="${cls}" data-fid="${f.id}">${label}<textarea id="${id}" data-f="${f.id}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} rows="3">${escapeHtml(v || "")}</textarea>${hint}${edit}</div>`;
    case "date":
      return `<div class="${cls}" data-fid="${f.id}">${label}<input id="${id}" data-f="${f.id}" type="date" value="${escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "")}" />${hint}${edit}</div>`;
    case "email":
      return `<div class="${cls}" data-fid="${f.id}">${label}<input id="${id}" data-f="${f.id}" type="email" inputmode="email" autocomplete="email" autocapitalize="none" enterkeyhint="next" value="${escapeHtml(v || "")}" />${hint}${edit}</div>`;
    case "tel":
      return `<div class="${cls}" data-fid="${f.id}">${label}<input id="${id}" data-f="${f.id}" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" value="${escapeHtml(v || "")}" />${hint}${edit}</div>`;
    case "number":
      return `<div class="${cls}" data-fid="${f.id}">${label}<input id="${id}" data-f="${f.id}" type="text" inputmode="decimal" enterkeyhint="next" value="${escapeHtml(v || "")}" />${hint}${edit}</div>`;
    case "radio": {
      const opts = f.options.map((o) => `<button type="button" class="fn-opt${v === o ? " on" : ""}" data-radio="${f.id}" data-opt="${escapeHtml(o)}" aria-pressed="${v === o}">${v === o ? icon("check") : ""}${escapeHtml(f.optLabels[o] || o)}</button>`).join("");
      return `<div class="${cls}" data-fid="${f.id}"><label>${escapeHtml(f.label)}${req}</label><div class="fn-opts" role="group" aria-label="${escapeHtml(f.label)}">${opts}</div>${hint}${edit}</div>`;
    }
    case "multi": {
      const cur = Array.isArray(v) ? v : [];
      const opts = f.options.map((o) => `<button type="button" class="fn-opt${cur.includes(o) ? " on" : ""}" data-multi="${f.id}" data-opt="${escapeHtml(o)}" aria-pressed="${cur.includes(o)}">${cur.includes(o) ? icon("check") : ""}${escapeHtml(o)}</button>`).join("");
      return `<div class="${cls}" data-fid="${f.id}"><label>${escapeHtml(f.label)}${req}</label><div class="fn-opts" role="group">${opts}</div>${hint}${edit}</div>`;
    }
    case "select": {
      const opts = [`<option value="">Choose…</option>`].concat(f.options.map((o) => `<option value="${escapeHtml(o)}"${v === o ? " selected" : ""}>${escapeHtml(o)}</option>`));
      return `<div class="${cls}" data-fid="${f.id}">${label}<select id="${id}" data-f="${f.id}">${opts.join("")}</select>${hint}${edit}</div>`;
    }
    case "photo":
      return `<div class="${cls}" data-fid="${f.id}"><label>${escapeHtml(f.label)}${req}</label>
        <div class="fn-card${v ? " has" : ""}">
          <div class="fn-photo">${v ? `<img src="${v}" alt="${escapeHtml(f.label)}" />` : `${icon("image", "ico")}<span>No photo yet</span>`}</div>
          <div class="fn-btns"><button type="button" class="btn sm" data-cam="${f.id}">${icon("camera")}Take photo</button><button type="button" class="btn sm" data-pick="${f.id}">${icon("image")}${v ? "Replace" : "Choose"}</button></div>
          ${v ? `<div class="sig-actions"><span class="sig-note">Fits into the box on the PDF</span><button type="button" class="fn-clear" data-clear="${f.id}">Remove</button></div>` : ""}
        </div>${hint}${edit}</div>`;
    case "signature":
      return `<div class="${cls}" data-fid="${f.id}"><label>${escapeHtml(f.label)}${req}</label>
        <div class="fn-card sig-panel${v ? " signed has" : ""}">
          <div class="sig-box" data-sign="${f.id}" role="button" tabindex="0" aria-label="Sign: ${escapeHtml(f.label)}">${v ? `<img class="sig-img" src="${v}" alt="Signature" />` : ""}<span class="sig-hint">${icon("sign")}Tap to sign</span></div>
          <div class="sig-actions"><span class="sig-note">${v ? "Signed" : "Sign with finger or stylus"}</span><button type="button" class="sig-clear" data-clear="${f.id}">Clear</button></div>
        </div>${hint}${edit}</div>`;
    default:
      return `<div class="${cls}" data-fid="${f.id}">${label}<input id="${id}" data-f="${f.id}" type="text" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} autocomplete="off" autocapitalize="${/name|city|street|address/i.test(f.label) ? "words" : "sentences"}" enterkeyhint="next" value="${escapeHtml(v || "")}" />${hint}${edit}</div>`;
  }
}
function checkHtml(doc, f) {
  const on = !!doc.values[f.id];
  return `<div class="fn-check${f.hidden ? " off" : ""}" data-fid="${f.id}"><span>${escapeHtml(f.label)}${f.required ? ' <span class="req" style="color:var(--danger);font-weight:800">*</span>' : ""}</span>
    <button type="button" class="check-toggle${on ? " on" : ""}" data-check="${f.id}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(f.label)}">${on ? "YES" : "NO"}</button>
    <button type="button" class="fn-edit" data-edit="${f.id}">${icon("pencil", "ico sm")}Edit</button></div>`;
}
function cardBodyHtml(doc, card) {
  let html = "", checks = "", i = 0;
  const flush = () => { if (checks) { html += `<div class="fn-checks">${checks}</div>`; checks = ""; } };
  const fs = card.fields;
  while (i < fs.length) {
    const f = fs[i];
    if (f.kind === "check") { checks += checkHtml(doc, f); i++; continue; }
    flush();
    if (COMPACT.has(f.kind)) {
      const row = [f];
      let j = i + 1;
      while (j < fs.length && COMPACT.has(fs[j].kind) && fs[j].page === f.page && Math.abs((fs[j].rects[0].y + fs[j].rects[0].h / 2) - (f.rects[0].y + f.rects[0].h / 2)) < 7 && row.length < 3) { row.push(fs[j]); j++; }
      html += row.length > 1 ? `<div class="fn-row">${row.map((r) => fieldHtml(doc, r)).join("")}</div>` : fieldHtml(doc, f);
      i = j;
    } else { html += fieldHtml(doc, f); i++; }
  }
  flush();
  return html;
}
let cardsCache = [];
function renderDoc(keepScroll) {
  const doc = activeDoc();
  if (!doc) return;
  const y = window.scrollY;
  const openState = {};
  document.querySelectorAll("#docBody details.card").forEach((d) => (openState[d.dataset.key] = d.open));
  const cards = (cardsCache = groupCards(doc));
  const many = cards.length > 4;
  const attOpen = openState.att;
  let html = "";
  if (!doc.fields.length) {
    html += `<div class="fn-empty">
      <svg viewBox="0 0 140 110" fill="none" aria-hidden="true"><rect x="38" y="8" width="64" height="86" rx="9" fill="currentColor" fill-opacity=".10" stroke="currentColor" stroke-width="2.4"/><path d="M50 30h40M50 44h40M50 58h24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
      <h3>No fillable fields found</h3>
      <p>This PDF is flat, so there is nothing to lay out yet. Tap where each answer belongs and FieldNote will build the form for you.</p>
      <button type="button" class="btn primary" id="btnPlaceEmpty" style="margin-top:16px">${icon("plus")}Add fields by hand</button></div>`;
  }
  html += `<div class="edit-bar"><span>Editing layout · tap Edit on any field</span><button type="button" class="btn sm primary" id="btnEditDone">Done</button></div>`;
  cards.forEach((c, idx) => {
    const open = openState[c.key] !== undefined ? openState[c.key] : (!many || idx === 0);
    html += `<details class="card" id="${c.id}" data-key="${c.key}" ${open ? "open" : ""}>
      <summary><span class="sec-ico">${icon("clip", "ico")}</span>
        <div><h2>${escapeHtml(c.title)}</h2><span class="count" data-card-count></span></div>
        <span class="pill" data-card-pill></span>${icon("chev", "ico chev")}</summary>
      <div>${cardBodyHtml(doc, c)}</div></details>`;
  });
  html += attachmentsHtml(doc, attOpen);
  $("docBody").innerHTML = html;
  renderHero();
  renderNav();
  updateProgress();
  if (keepScroll) window.scrollTo(0, y);
}
function attachmentsHtml(doc, open) {
  const items = doc.attachments.map((a) => `<div class="fn-card has" data-att="${a.id}">
      <div class="fn-photo"><img src="${a.data}" alt="Attachment" /></div>
      <label for="cap_${a.id}">Caption</label><input id="cap_${a.id}" data-cap="${a.id}" placeholder="Optional caption printed under the photo" value="${escapeHtml(a.caption || "")}" />
      <div class="sig-actions"><span class="sig-note">Added as its own page</span><button type="button" class="fn-clear" data-att-del="${a.id}">Remove</button></div></div>`).join("");
  return `<details class="card" id="card_att" data-key="att" ${open || doc.attachments.length ? "open" : ""}>
    <summary><span class="sec-ico">${icon("image", "ico")}</span><div><h2>Extra photos</h2><span class="count">${doc.attachments.length ? `${doc.attachments.length} added as extra pages` : "Optional · add pages with photos"}</span></div>${icon("chev", "ico chev")}</summary>
    <div>${items}<div class="fn-btns"><button type="button" class="btn sm" data-att-cam>${icon("camera")}Take photo</button><button type="button" class="btn sm" data-att-pick>${icon("image")}Add photo</button></div></div></details>`;
}
function renderHero() {
  const doc = activeDoc();
  if (!doc) return;
  const p = progress(doc);
  const pct = Math.round(p.frac * 100);
  const nFields = doc.fields.filter((f) => !f.hidden).length;
  $("docHero").innerHTML = `
    <input class="title-input" id="docTitle" value="${escapeHtml(doc.name)}" aria-label="Form name" autocomplete="off" />
    <div class="fn-hero-meta">${doc.isTemplate ? '<span class="tpl-tag">Template</span>' : ""}<span>${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}</span><span>·</span><span>${nFields} field${nFields === 1 ? "" : "s"}</span></div>
    ${p.total ? `<div class="fn-bar-row"><div class="fn-bar${p.done === p.total ? " done" : ""}" id="heroBar"><i style="width:${pct}%"></i></div><b id="heroCount">${p.done} of ${p.total}</b></div>` : ""}
    ${doc.skipped && (doc.skipped.readOnly || doc.skipped.buttons) ? `<p class="fn-note info">${doc.skipped.readOnly ? `${doc.skipped.readOnly} read-only field${doc.skipped.readOnly === 1 ? "" : "s"} left as is. ` : ""}${doc.skipped.buttons ? `${doc.skipped.buttons} button${doc.skipped.buttons === 1 ? "" : "s"} ignored.` : ""}</p>` : ""}`;
  $("barTitle").textContent = doc.name;
  $("barSub").textContent = doc.isTemplate ? "Template" : p.total ? `${p.done} of ${p.total} answered` : "Form";
}
function updateProgress() {
  const doc = activeDoc();
  if (!doc) return;
  cardsCache.forEach((c) => {
    const ans = c.fields.filter((f) => !f.hidden && f.kind !== "check");
    const done = ans.filter((f) => isFilled(doc, f)).length;
    const el = $(c.id);
    if (!el) return;
    const checks = c.fields.filter((f) => f.kind === "check" && !f.hidden).length;
    const parts = [`Page ${c.page + 1}`];
    if (ans.length) parts.push(`${done} of ${ans.length} answered`);
    else if (checks) parts.push(`${checks} checkbox${checks === 1 ? "" : "es"}`);
    el.querySelector("[data-card-count]").textContent = parts.join(" · ");
    const pill = el.querySelector("[data-card-pill]");
    pill.textContent = ans.length ? `${done}/${ans.length}` : "–";
    el.classList.toggle("card-done", ans.length > 0 && done === ans.length);
    c._done = ans.length > 0 && done === ans.length;
    c._meta = ans.length ? `${done}/${ans.length}` : "";
  });
  const p = progress(doc);
  const bar = $("heroBar");
  if (bar) { bar.classList.toggle("done", p.done === p.total); bar.firstChild.style.width = Math.round(p.frac * 100) + "%"; }
  if ($("heroCount")) $("heroCount").textContent = `${p.done} of ${p.total}`;
  $("barSub").textContent = doc.isTemplate ? "Template" : p.total ? `${p.done} of ${p.total} answered` : "Form";
  document.querySelectorAll(".sn-btn").forEach((b) => {
    const c = cardsCache.find((x) => x.id === b.dataset.sec);
    if (!c) return;
    b.classList.toggle("ok", !!c._done);
    const m = b.querySelector(".sn-meta");
    if (m) m.textContent = c._meta || "";
  });
}
function renderNav() {
  const nav = $("sectionNav");
  const cards = cardsCache;
  if (cards.length < 2) { nav.innerHTML = ""; return; }
  let items;
  if (cards.length <= 8) items = cards.map((c) => ({ id: c.id, label: c.title.length > 18 ? c.title.slice(0, 17) + "…" : c.title }));
  else {
    const seen = new Set();
    items = [];
    cards.forEach((c) => { if (!seen.has(c.page)) { seen.add(c.page); items.push({ id: c.id, label: `Page ${c.page + 1}` }); } });
  }
  nav.innerHTML = items.map((i) => `<button type="button" class="sn-btn" data-sec="${i.id}"><span class="sn-dot"></span>${escapeHtml(i.label)}<span class="sn-meta"></span></button>`).join("");
}
let sectionLock = 0;
function goSection(id) {
  const el = $(id);
  if (!el) return;
  el.open = true;
  sectionLock = Date.now() + 700;
  setActiveSection(id);
  const top = el.getBoundingClientRect().top + window.scrollY - headerH() - 10;
  window.scrollTo({ top, behavior: "smooth" });
}
function headerH() { return $("appHeader").getBoundingClientRect().height; }
function syncHeaderH() { document.documentElement.style.setProperty("--hdr-h", headerH() + "px"); }
function setActiveSection(id) {
  const nav = $("sectionNav");
  document.querySelectorAll(".sn-btn").forEach((b) => {
    const on = b.dataset.sec === id;
    b.classList.toggle("on", on);
    if (on && nav) nav.scrollTo({ left: b.offsetLeft - 16, behavior: "smooth" });
  });
}
function onScroll() {
  const hdr = $("appHeader");
  hdr.classList.toggle("scrolled", window.scrollY > 4);
  if (S.listMode) return;
  const hero = $("docHero");
  hdr.classList.toggle("show-title", hero.getBoundingClientRect().bottom < headerH() + 8);
  if (Date.now() < sectionLock) return;
  const line = headerH() + 60;
  let cur = "";
  const btns = [...document.querySelectorAll(".sn-btn")];
  const ids = btns.map((b) => b.dataset.sec);
  // an item for "Page N" stands for every card on that page
  cardsCache.forEach((c) => {
    const el = $(c.id);
    if (el && el.getBoundingClientRect().top <= line) cur = ids.includes(c.id) ? c.id : (cardsCache.find((x) => x.page === c.page && ids.includes(x.id)) || {}).id || cur;
  });
  setActiveSection(cur);
}

// ------------------------------------------------------------- editor: input handling
function setValue(f, v) {
  const doc = activeDoc();
  const empty = v === "" || v === null || v === false || (Array.isArray(v) && !v.length);
  if (empty) delete doc.values[f.id]; else doc.values[f.id] = v;
  touch(doc);
  updateProgress();
}
function fieldById(id) { const d = activeDoc(); return d && d.fields.find((f) => f.id === id); }
function replaceField(fid) {
  const doc = activeDoc();
  const f = fieldById(fid);
  const el = document.querySelector(`.fn-field[data-fid="${fid}"]`);
  if (!f || !el) return;
  const t = document.createElement("template");
  t.innerHTML = fieldHtml(doc, f).trim();
  el.replaceWith(t.content.firstChild);
  updateProgress();
}
function jumpToField(fid) {
  const el = document.querySelector(`[data-fid="${fid}"]`);
  if (!el) return;
  const card = el.closest("details");
  if (card) card.open = true;
  sectionLock = Date.now() + 800;
  const top = el.getBoundingClientRect().top + window.scrollY - headerH() - 80;
  window.scrollTo({ top, behavior: "smooth" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1300);
  const inp = el.querySelector("input,textarea,select");
  if (inp) setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 350);
}
async function readImage(file, max, type, q) {
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
  if (!bmp) {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bmp.width, h0 = bmp.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(type || "image/jpeg", q || 0.86);
}
let photoTarget = null;
function wireEditor() {
  const body = $("docBody");
  body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.f) { const f = fieldById(t.dataset.f); if (f) setValue(f, t.value); }
    else if (t.dataset && t.dataset.cap) { const a = activeDoc().attachments.find((x) => x.id === t.dataset.cap); if (a) { a.caption = t.value; touch(activeDoc()); } }
  });
  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.f && t.tagName === "SELECT") { const f = fieldById(t.dataset.f); if (f) setValue(f, t.value); }
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && !e.isComposing) {
      const all = [...body.querySelectorAll("input[data-f],textarea[data-f],select[data-f]")];
      const i = all.indexOf(e.target);
      if (i >= 0 && all[i + 1]) { e.preventDefault(); all[i + 1].focus(); } else if (i >= 0) e.target.blur();
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-sign]")) { e.preventDefault(); openSig(e.target.dataset.sign); }
  });
  body.addEventListener("click", (e) => {
    const doc = activeDoc();
    const q = (sel) => e.target.closest(sel);
    let el;
    if ((el = q("[data-edit]"))) return openFieldEdit(el.dataset.edit);
    if (q("#btnEditDone")) return setEditing(false);
    if (q("#btnPlaceEmpty")) return openPlacer();
    if ((el = q("[data-check]"))) {
      const f = fieldById(el.dataset.check);
      const on = !doc.values[f.id];
      setValue(f, on);
      el.classList.toggle("on", on); el.setAttribute("aria-checked", on); el.textContent = on ? "YES" : "NO";
      return;
    }
    if ((el = q("[data-radio]"))) {
      const f = fieldById(el.dataset.radio), o = el.dataset.opt;
      setValue(f, doc.values[f.id] === o ? "" : o);
      replaceField(f.id);
      return;
    }
    if ((el = q("[data-multi]"))) {
      const f = fieldById(el.dataset.multi), o = el.dataset.opt;
      const cur = Array.isArray(doc.values[f.id]) ? doc.values[f.id].slice() : [];
      const i = cur.indexOf(o);
      if (i >= 0) cur.splice(i, 1); else cur.push(o);
      setValue(f, cur);
      replaceField(f.id);
      return;
    }
    if ((el = q("[data-sign]"))) return openSig(el.dataset.sign);
    if ((el = q("[data-clear]"))) { const f = fieldById(el.dataset.clear); setValue(f, ""); replaceField(f.id); return; }
    if ((el = q("[data-cam]"))) { photoTarget = el.dataset.cam; return $("photoCam").click(); }
    if ((el = q("[data-pick]"))) { photoTarget = el.dataset.pick; return $("photoPick").click(); }
    if (q("[data-att-cam]")) { photoTarget = "@att"; return $("photoCam").click(); }
    if (q("[data-att-pick]")) { photoTarget = "@att"; return $("photoPick").click(); }
    if ((el = q("[data-att-del]"))) {
      doc.attachments = doc.attachments.filter((a) => a.id !== el.dataset.attDel);
      touch(doc);
      renderDoc(true);
    }
  });
  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !photoTarget) return;
    const doc = activeDoc();
    try {
      busy("Adding photo…");
      const data = await readImage(file, 1800, "image/jpeg", 0.86);
      if (photoTarget === "@att") {
        doc.attachments.push({ id: uid(), data, caption: "" });
        touch(doc);
        renderDoc(true);
      } else {
        const f = fieldById(photoTarget);
        setValue(f, data);
        replaceField(f.id);
      }
    } catch (err) { console.error(err); toast("Couldn't read that image"); }
    busy(null);
  };
  $("photoPick").addEventListener("change", onPhoto);
  $("photoCam").addEventListener("change", onPhoto);
  $("docHero").addEventListener("input", (e) => {
    if (e.target.id === "docTitle") {
      const doc = activeDoc();
      doc.name = e.target.value.trim() || "Untitled";
      $("barTitle").textContent = doc.name;
      touch(doc);
    }
  });
}

// ------------------------------------------------------------- edit layout
function setEditing(on) {
  S.editing = !!on;
  document.body.classList.toggle("editing", S.editing);
  $("editLayoutTitle").textContent = S.editing ? "Finish editing layout" : "Edit layout";
  renderDoc(true);
}
let editingFid = null;
let editFromPlacer = false;
function openFieldEdit(fid, fromPlacer) {
  editFromPlacer = !!fromPlacer;
  const f = fieldById(fid);
  if (!f) return;
  editingFid = fid;
  $("fieldPdfName").textContent = `PDF field: ${f.name}`;
  $("fe_label").value = f.label;
  $("fe_hint").value = f.hint || "";
  const allowed = f.origin === "flat" ? TEXT_KINDS.concat(["check", "photo", "signature"]) : f.origin === "text" ? TEXT_KINDS.concat(["photo", "signature"]) : f.origin === "button" || f.origin === "photo" || f.origin === "signature" ? ["photo", "signature"] : [f.kind];
  $("fe_kind").innerHTML = allowed.map((k) => `<option value="${k}"${k === f.kind ? " selected" : ""}>${KIND_NAMES[k]}</option>`).join("");
  $("fe_kind").disabled = allowed.length < 2;
  setSwitch($("fe_req"), f.required);
  setSwitch($("fe_vis"), !f.hidden, "YES", "NO");
  openSheet("fieldSheet");
}
function wireFieldSheet() {
  const apply = () => {
    const f = fieldById(editingFid);
    if (!f) return;
    f.label = $("fe_label").value.trim() || f.label;
    f.hint = $("fe_hint").value.trim();
    f.kind = $("fe_kind").value || f.kind;
    f.required = $("fe_req").classList.contains("on");
    f.hidden = !$("fe_vis").classList.contains("on");
    touch(activeDoc());
  };
  $("fe_label").addEventListener("input", apply);
  $("fe_hint").addEventListener("input", apply);
  $("fe_kind").addEventListener("change", apply);
  $("fe_req").addEventListener("click", () => { setSwitch($("fe_req"), !$("fe_req").classList.contains("on")); apply(); });
  $("fe_vis").addEventListener("click", () => { setSwitch($("fe_vis"), !$("fe_vis").classList.contains("on")); apply(); });
  const close = () => { apply(); closeSheet("fieldSheet"); if (editFromPlacer) { editFromPlacer = false; renderPlaceBoxes(); } else renderDoc(true); };
  $("btnCloseField").addEventListener("click", close);
  $("fieldBack").addEventListener("click", close);
}

// ------------------------------------------------------------- signature pad
let sigTarget = null, sigDrawing = false;
const sigCtx = () => $("sigPad").getContext("2d");
function resizeSigPad(keep) {
  const canvas = $("sigPad");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let snap = null;
  if (keep === true && canvas.width && canvas.height) {
    snap = document.createElement("canvas");
    snap.width = canvas.width; snap.height = canvas.height;
    snap.getContext("2d").drawImage(canvas, 0, 0);
  }
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(160, Math.floor((rect.height || 220) * dpr));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (snap) {
    const s = Math.min(canvas.width / snap.width, canvas.height / snap.height);
    ctx.drawImage(snap, (canvas.width - snap.width * s) / 2, (canvas.height - snap.height * s) / 2, snap.width * s, snap.height * s);
  }
  ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2.4 * dpr; ctx.lineCap = "round"; ctx.lineJoin = "round";
}
function sigPoint(e) {
  const canvas = $("sigPad");
  const rect = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
}
function setSigWide(on) {
  $("sigSheet").classList.toggle("wide", !!on);
  document.documentElement.classList.toggle("sig-wide", !!on);
  $("btnSigWide").setAttribute("aria-pressed", on ? "true" : "false");
  requestAnimationFrame(() => resizeSigPad(false));
}
const sigIsWide = () => $("sigSheet").classList.contains("wide") && innerHeight > innerWidth;
function openSig(fid) {
  sigTarget = fid;
  const f = fieldById(fid);
  setSigWide(false);
  $("sigTitle").textContent = f ? f.label : "Sign here";
  openSheet("sigSheet");
  requestAnimationFrame(() => resizeSigPad(false));
  setTimeout(() => resizeSigPad(false), 280);
}
function closeSig() { closeSheet("sigSheet"); setSigWide(false); sigDrawing = false; }
function cropSignature(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 12) continue;
    found = true;
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (!found) return "";
  const pad = Math.round(8 * (window.devicePixelRatio || 1));
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL("image/png");
}
function uprightSig(canvas) {
  const out = document.createElement("canvas");
  out.width = canvas.height; out.height = canvas.width;
  const ctx = out.getContext("2d");
  ctx.setTransform(0, -1, 1, 0, 0, canvas.width);
  ctx.drawImage(canvas, 0, 0);
  return out;
}
function saveSig() {
  const pad = $("sigPad");
  const url = cropSignature(sigIsWide() ? uprightSig(pad) : pad);
  if (!url) { toast("Draw your signature first"); return; }
  const f = fieldById(sigTarget);
  if (f) { setValue(f, url); replaceField(f.id); }
  closeSig();
  toast("Signature saved");
}
function wireSig() {
  $("btnCloseSig").addEventListener("click", closeSig);
  $("sigBack").addEventListener("click", closeSig);
  $("btnSigRedo").addEventListener("click", () => resizeSigPad(false));
  $("btnSigSave").addEventListener("click", saveSig);
  $("btnSigWide").addEventListener("click", () => setSigWide(!$("sigSheet").classList.contains("wide")));
  let t = 0;
  window.addEventListener("resize", () => { if ($("sigSheet").classList.contains("show")) { clearTimeout(t); t = setTimeout(() => resizeSigPad(true), 250); } });
  const pad = $("sigPad");
  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); sigDrawing = true; const p = sigPoint(e); const c = sigCtx(); c.beginPath(); c.moveTo(p.x, p.y); });
  pad.addEventListener("pointermove", (e) => { if (!sigDrawing) return; e.preventDefault(); const p = sigPoint(e); const c = sigCtx(); c.lineTo(p.x, p.y); c.stroke(); });
  const end = () => { sigDrawing = false; };
  ["pointerup", "pointercancel", "pointerleave"].forEach((n) => pad.addEventListener(n, end));
}

// ------------------------------------------------------------- export
function dataUrlToBytes(u) { return b64ToBytes(u.slice(u.indexOf(",") + 1)); }
function safeText(s, font) {
  s = String(s).replace(/\r\n?/g, "\n");
  try { font.encodeText(s); return s; } catch (e) {}
  return s.replace(/[^\n\x20-\x7E\xA0-\xFF‘’“”–—…•€™]/g, "?");
}
function exportChecks(doc) {
  const out = [];
  doc.fields.forEach((f) => {
    if (f.hidden || !f.required) return;
    const v = doc.values[f.id];
    const ok = f.kind === "check" ? !!v : isFilled(doc, f);
    if (!ok) out.push({ label: f.label, fid: f.id });
  });
  return out;
}
async function buildPdf(doc) {
  const L = PDFLib;
  const pdf = await L.PDFDocument.load(doc.pdf, { ignoreEncryption: true, updateMetadata: false });
  const helv = await pdf.embedFont(L.StandardFonts.Helvetica);
  const pages = pdf.getPages();
  let form = null;
  try { form = pdf.getForm(); } catch (e) {}
  const notes = [];
  const fmt = S.prefs.dateFmt;
  const tryField = (f, fn) => { try { fn(); } catch (e) { console.warn("field failed", f.name, e); notes.push(`“${f.label}” couldn't be written`); } };
  const stamps = [];
  const flats = [];
  for (const f of doc.fields) {
    if (f.hidden) continue;
    const v = doc.values[f.id];
    const has = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "" && v !== null;
    if (f.kind === "photo" || f.kind === "signature") {
      if (has) stamps.push({ f, v });
      continue;
    }
    if (f.origin === "flat") {
      if (has) flats.push({ f, v });
      continue;
    }
    if (!form) continue;
    if (f.origin === "text") {
      tryField(f, () => {
        const tf = form.getTextField(f.name);
        if (has) {
          let t = f.kind === "date" ? formatDate(v, f.dateFmt || fmt) : String(v);
          t = safeText(t, helv);
          if (f.maxLength && t.length > f.maxLength) t = t.slice(0, f.maxLength);
          tf.setText(t);
        } else if (f.defaultValue) tf.setText(undefined);
      });
    } else if (f.origin === "check") {
      tryField(f, () => { const cb = form.getCheckBox(f.name); if (v) cb.check(); else cb.uncheck(); });
    } else if (f.origin === "radio") {
      tryField(f, () => { if (has) form.getRadioGroup(f.name).select(v); else if (f.defaultValue) form.getRadioGroup(f.name).clear(); });
    } else if (f.origin === "select") {
      tryField(f, () => {
        let fld;
        try { fld = form.getDropdown(f.name); } catch (e) { fld = form.getOptionList(f.name); }
        if (has) { if (fld.addOptions && !fld.getOptions().includes(v)) fld.addOptions([v]); fld.select(v); } else fld.clear();
      });
    } else if (f.origin === "multi") {
      tryField(f, () => { const ol = form.getOptionList(f.name); if (has) ol.select(v); else ol.clear(); });
    }
  }
  if (form) { try { form.updateFieldAppearances(helv); } catch (e) { console.warn(e); } }
  for (const { f, v } of flats) {
    try {
      const r = f.rects[0];
      const page = pages[r.page] || pages[0];
      if (f.kind === "check") {
        const k = Math.min(r.w, r.h);
        const ox = r.x + (r.w - k) / 2, oy = r.y + (r.h - k) / 2;
        const col = L.rgb(0.1, 0.1, 0.1), th = Math.max(1, k * 0.12);
        page.drawLine({ start: { x: ox + k * 0.18, y: oy + k * 0.5 }, end: { x: ox + k * 0.42, y: oy + k * 0.22 }, thickness: th, color: col });
        page.drawLine({ start: { x: ox + k * 0.42, y: oy + k * 0.22 }, end: { x: ox + k * 0.84, y: oy + k * 0.8 }, thickness: th, color: col });
        continue;
      }
      let t = safeText(f.kind === "date" ? formatDate(v, f.dateFmt || fmt) : String(v), helv);
      const pad = 2;
      if (f.kind === "multiline") {
        const size = 10, lead = size * 1.25;
        const lines = [];
        t.split("\n").forEach((para) => {
          let cur = "";
          para.split(/\s+/).forEach((w) => {
            const test = cur ? cur + " " + w : w;
            if (helv.widthOfTextAtSize(test, size) <= r.w - pad * 2 || !cur) cur = test; else { lines.push(cur); cur = w; }
          });
          lines.push(cur);
        });
        lines.slice(0, Math.max(1, Math.floor((r.h - pad * 2) / lead))).forEach((ln, i) => page.drawText(ln, { x: r.x + pad, y: r.y + r.h - pad - size - i * lead + size * 0.15, size, font: helv, color: L.rgb(0.08, 0.08, 0.08) }));
      } else {
        let size = Math.min(11, Math.max(6, r.h * 0.66));
        while (size > 5 && helv.widthOfTextAtSize(t, size) > r.w - pad * 2) size -= 0.5;
        page.drawText(t, { x: r.x + pad, y: r.y + (r.h - size) / 2 + size * 0.18, size, font: helv, color: L.rgb(0.08, 0.08, 0.08) });
      }
    } catch (e) { notes.push(`“${f.label}” couldn't be written`); }
  }
  const embedded = new Map();
  const embed = async (data) => {
    if (embedded.has(data)) return embedded.get(data);
    const bytes = dataUrlToBytes(data);
    const img = /^data:image\/png/.test(data) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    embedded.set(data, img);
    return img;
  };
  for (const { f, v } of stamps) {
    try {
      const img = await embed(v);
      f.rects.forEach((r) => {
        const page = pages[r.page] || pages[0];
        const pad = 1.5;
        const bw = Math.max(1, r.w - pad * 2), bh = Math.max(1, r.h - pad * 2);
        const s = Math.min(bw / img.width, bh / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h });
      });
      if (form) { try { form.removeField(form.getField(f.name)); } catch (e) {} }
    } catch (e) { console.warn(e); notes.push(`“${f.label}” image couldn't be added`); }
  }
  if (doc.flatten && form) { try { form.flatten({ updateFieldAppearances: false }); } catch (e) { notes.push("Couldn't flatten the form"); } }
  // extra photo pages
  const base = pages[0] ? pages[0].getSize() : { width: 612, height: 792 };
  for (const a of doc.attachments) {
    try {
      const img = await embed(a.data);
      const page = pdf.addPage([base.width, base.height]);
      const m = 36, capH = a.caption ? 34 : 0;
      const bw = base.width - m * 2, bh = base.height - m * 2 - capH;
      const s = Math.min(bw / img.width, bh / img.height, 1.6);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: (base.width - w) / 2, y: base.height - m - h, width: w, height: h });
      if (a.caption) {
        const t = safeText(a.caption, helv);
        const size = 12;
        const tw = helv.widthOfTextAtSize(t.split("\n")[0], size);
        page.drawText(t.split("\n")[0], { x: Math.max(m, (base.width - tw) / 2), y: base.height - m - h - 22, size, font: helv, color: L.rgb(0.2, 0.2, 0.2) });
      }
    } catch (e) { notes.push("A photo page couldn't be added"); }
  }
  pdf.setProducer("FieldNote");
  pdf.setModificationDate(new Date());
  const bytes = await pdf.save();
  return { bytes, notes };
}
let reviewPdf = null;
function fileNameFor(doc) {
  return (doc.name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "form") + ".pdf";
}
async function renderPreview(bytes, box) {
  const lib = await loadPdfJs();
  const task = lib.getDocument(Object.assign({ data: bytes.slice() }, pdfjsOpts()));
  const pdf = await task.promise;
  box.innerHTML = "";
  const width = Math.max(300, box.clientWidth - 20);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const v0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: (width / v0.width) * dpr });
    const c = document.createElement("canvas");
    c.className = "pdf-page";
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    box.appendChild(c);
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  }
  try { pdf.destroy(); } catch (e) {}
}
async function openReview() {
  const doc = activeDoc();
  if (!doc) return;
  await flushSaves();
  reviewPdf = null;
  $("btnPdfDownload").disabled = true; $("btnPdfShare").disabled = true;
  const checks = exportChecks(doc);
  const chk = $("pdfCheck");
  if (checks.length) {
    chk.classList.remove("ok");
    chk.innerHTML = `<div class="check-title">${icon("alert")}${checks.length} required field${checks.length === 1 ? "" : "s"} still empty. You can export anyway.</div>` +
      checks.map((c) => `<button type="button" class="check-item" data-jump-field="${c.fid}">${icon("alert")}<span>${escapeHtml(c.label)}</span><span class="go">Go to</span></button>`).join("");
  } else {
    chk.classList.add("ok");
    chk.innerHTML = `<div class="check-ok">${icon("check")}Everything required is filled in</div>`;
  }
  $("pdfPages").innerHTML = `<div class="pdf-msg">Building your PDF…</div>`;
  openSheet("pdfSheet");
  try {
    const { bytes, notes } = await buildPdf(doc);
    reviewPdf = { bytes, name: fileNameFor(doc) };
    if (notes.length) chk.insertAdjacentHTML("beforeend", `<div class="check-title" style="border-top:1px solid var(--line)">${icon("alert")}${escapeHtml(notes.slice(0, 4).join(" · "))}${notes.length > 4 ? ` · +${notes.length - 4} more` : ""}</div>`);
    $("btnPdfDownload").disabled = false;
    $("btnPdfShare").disabled = false;
    try { await withTimeout(renderPreview(bytes, $("pdfPages")), 45000, "Preview"); }
    catch (e) { console.warn(e); $("pdfPages").innerHTML = `<div class="pdf-msg static">Preview isn't available here, but your PDF is ready. Use Save or Share.</div>`; }
  } catch (e) {
    console.error(e);
    $("pdfPages").innerHTML = `<div class="pdf-msg static">Couldn't build this PDF.<br><span class="count">${escapeHtml(e && e.message || e)}</span></div>`;
  }
  const canShare = !!(navigator.canShare && navigator.share && reviewPdf && navigator.canShare({ files: [new File([reviewPdf.bytes], reviewPdf.name, { type: "application/pdf" })] }));
  $("pdfShareNote").classList.toggle("hidden", canShare);
  $("btnPdfShare").classList.toggle("hidden", !canShare);
  $("pdfActions").style.gridTemplateColumns = canShare ? "" : "1fr";
}
function downloadBlob(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function wireReview() {
  const close = () => closeSheet("pdfSheet");
  $("btnPdfClose").addEventListener("click", close);
  $("pdfBack").addEventListener("click", close);
  $("btnPdfDownload").addEventListener("click", () => { if (reviewPdf) { downloadBlob(reviewPdf.bytes, reviewPdf.name, "application/pdf"); toast("Saved"); } });
  $("btnPdfShare").addEventListener("click", async () => {
    if (!reviewPdf) return;
    try { await navigator.share({ files: [new File([reviewPdf.bytes], reviewPdf.name, { type: "application/pdf" })], title: reviewPdf.name }); }
    catch (e) { if (e && e.name !== "AbortError") toast("Couldn't share – try Save"); }
  });
  $("pdfCheck").addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump-field]");
    if (!b) return;
    close();
    setTimeout(() => jumpToField(b.dataset.jumpField), 380);
  });
  $("btnExport").addEventListener("click", openReview);
}


// ------------------------------------------------------------- manual field placer
const PLACE_SIZES = { text: [150, 18], multiline: [230, 64], date: [90, 18], check: [14, 14], photo: [170, 120], signature: [170, 52] };
const PS = { kind: "text", sel: null, pdf: null, phrases: {}, drag: null, tap: null };
function resortFields(doc) {
  doc.fields.sort((a, b) => a.page - b.page || (Math.abs(b.rects[0].y - a.rects[0].y) > 6 ? b.rects[0].y - a.rects[0].y : a.rects[0].x - b.rects[0].x));
  doc.fields.forEach((f, i) => (f.order = i));
}
function pfStyle(doc, f) {
  const pg = doc.pages[f.rects[0].page], r = f.rects[0];
  return `left:${(r.x / pg.w * 100).toFixed(3)}%;top:${((pg.h - r.y - r.h) / pg.h * 100).toFixed(3)}%;width:${(r.w / pg.w * 100).toFixed(3)}%;height:${(r.h / pg.h * 100).toFixed(3)}%`;
}
function renderPlaceBoxes() {
  const doc = activeDoc();
  document.querySelectorAll(".place-layer").forEach((layer) => {
    const pi = +layer.dataset.page;
    layer.innerHTML = doc.fields.filter((f) => f.rects[0].page === pi && !f.hidden).map((f) => {
      const flat = f.origin === "flat";
      const sel = flat && PS.sel === f.id;
      return `<div class="pf${flat ? "" : " ghost"}${sel ? " sel" : ""}" data-pf="${f.id}" style="${pfStyle(doc, f)}">${flat ? `<span class="pf-tag">${escapeHtml(f.label)}</span>` : ""}${sel ? `<div class="pf-bar"><button type="button" data-pf-edit="${f.id}">Edit</button><button type="button" class="del" data-pf-del="${f.id}">Delete</button></div><i class="pf-h" data-pf-h="${f.id}"></i>` : ""}</div>`;
    }).join("");
  });
}
async function openPlacer() {
  const doc = activeDoc();
  if (!doc) return;
  closeSheet("menuSheet");
  PS.sel = null; PS.phrases = {};
  $("placeScreen").classList.remove("hidden");
  document.documentElement.classList.add("placing");
  const box = $("placePages");
  box.innerHTML = `<div class="pdf-msg">Loading pages…</div>`;
  try {
    const lib = await withTimeout(loadPdfJs(), 16000, "PDF viewer");
    PS.pdf = await lib.getDocument(Object.assign({ data: doc.pdf.slice() }, pdfjsOpts())).promise;
    box.innerHTML = "";
    const width = Math.min(820, Math.max(300, box.clientWidth - 20));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 0; i < doc.pages.length; i++) {
      const pg = await PS.pdf.getPage(i + 1);
      const v0 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: (width / v0.width) * dpr });
      const wrap = document.createElement("div");
      wrap.className = "place-page";
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      wrap.appendChild(c);
      const layer = document.createElement("div");
      layer.className = "place-layer"; layer.dataset.page = i;
      wrap.appendChild(layer);
      box.appendChild(wrap);
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      renderPlaceBoxes();
    }
    if (doc.pages.some((p) => p.rot)) toast("This PDF has rotated pages, so boxes may land off by a quarter turn");
  } catch (e) {
    console.warn(e);
    box.innerHTML = `<div class="pdf-msg static">Couldn't show the pages here. The PDF viewer didn't load, so check your connection and try again.</div>`;
  }
}
function closePlacer() {
  const doc = activeDoc();
  $("placeScreen").classList.add("hidden");
  document.documentElement.classList.remove("placing");
  try { if (PS.pdf) PS.pdf.destroy(); } catch (e) {}
  PS.pdf = null; PS.sel = null; PS.drag = null;
  if (doc) { resortFields(doc); touch(doc); renderDoc(false); window.scrollTo(0, 0); }
}
async function placePhrases(pageIdx) {
  if (PS.phrases[pageIdx]) return PS.phrases[pageIdx];
  if (!PS.pdf) return [];
  const pg = await PS.pdf.getPage(pageIdx + 1);
  const tc = await pg.getTextContent();
  return (PS.phrases[pageIdx] = buildPhrases(tc.items));
}
function addPlaced(pageIdx, fx, fy) {
  const doc = activeDoc();
  const pg = doc.pages[pageIdx];
  const [w, h] = PLACE_SIZES[PS.kind];
  const cx = fx * pg.w, cy = pg.h - fy * pg.h;
  const x = Math.max(2, Math.min(pg.w - w - 2, cx - w / 2));
  const y = Math.max(2, Math.min(pg.h - h - 2, cy - h / 2));
  const n = doc.fields.filter((f) => f.origin === "flat").length + 1;
  const f = {
    id: "p" + uid(), name: "fn_" + uid(), kind: PS.kind, origin: "flat", label: `${KIND_NAMES[PS.kind]} ${n}`, hint: "", group: "", _auto: true,
    page: pageIdx, rects: [{ x, y, w, h, page: pageIdx, opt: "" }], options: [], optLabels: {}, required: false, hidden: false, maxLength: 0, multiline: PS.kind === "multiline", defaultValue: null, order: 9999
  };
  doc.fields.push(f);
  PS.sel = f.id;
  touch(doc);
  renderPlaceBoxes();
  placePhrases(pageIdx).then((ph) => {
    if (!f._auto) return;
    const t = findLabel(f.rects[0], ph, PS.kind === "check" ? "right" : "left");
    if (t) { f.label = titleCaseIfShouting(t); touch(doc); renderPlaceBoxes(); }
  }).catch(() => {});
}
function wirePlacer() {
  $("placeDone").addEventListener("click", closePlacer);
  $("btnPlace").addEventListener("click", openPlacer);
  $("placeKinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pk]");
    if (!b) return;
    PS.kind = b.dataset.pk;
    document.querySelectorAll("#placeKinds [data-pk]").forEach((x) => x.classList.toggle("on", x === b));
    $("placeHint").textContent = `Tap the page to add a ${KIND_NAMES[PS.kind].toLowerCase()} field`;
  });
  const box = $("placePages");
  box.addEventListener("pointerdown", (e) => {
    const doc = activeDoc();
    const layer = e.target.closest(".place-layer");
    if (!layer) return;
    const bar = e.target.closest(".pf-bar");
    if (bar) return;
    const h = e.target.closest("[data-pf-h]");
    const pfEl = e.target.closest("[data-pf]");
    const f = pfEl ? doc.fields.find((x) => x.id === pfEl.dataset.pf) : null;
    if (f && f.origin === "flat") {
      e.preventDefault();
      if (PS.sel !== f.id) { PS.sel = f.id; renderPlaceBoxes(); }
      const lr = layer.getBoundingClientRect();
      const pg = doc.pages[f.rects[0].page];
      PS.drag = { id: f.id, mode: h ? "resize" : "move", sx: e.clientX, sy: e.clientY, r0: Object.assign({}, f.rects[0]), kx: pg.w / lr.width, ky: pg.h / lr.height, pw: pg.w, ph: pg.h };
      try { layer.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    PS.tap = { x: e.clientX, y: e.clientY, t: Date.now(), layer, id: e.pointerId };
  });
  box.addEventListener("pointermove", (e) => {
    const d = PS.drag;
    if (!d) return;
    const f = activeDoc().fields.find((x) => x.id === d.id);
    if (!f) return;
    const dx = (e.clientX - d.sx) * d.kx, dy = (e.clientY - d.sy) * d.ky;
    const r = f.rects[0];
    if (d.mode === "move") {
      r.x = Math.max(0, Math.min(d.pw - r.w, d.r0.x + dx));
      r.y = Math.max(0, Math.min(d.ph - r.h, d.r0.y - dy));
    } else {
      r.w = Math.max(8, Math.min(d.pw - r.x, d.r0.w + dx));
      const nh = Math.max(8, Math.min(d.ph - d.r0.y + d.r0.h, d.r0.h + dy));
      r.y = d.r0.y + d.r0.h - nh; r.h = nh;
    }
    const el = box.querySelector(`[data-pf="${d.id}"]`);
    if (el) el.setAttribute("style", pfStyle(activeDoc(), f));
  });
  const end = (e) => {
    const doc = activeDoc();
    if (PS.drag) { PS.drag = null; touch(doc); return; }
    const t = PS.tap;
    PS.tap = null;
    if (!t || e.type === "pointercancel") return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || Date.now() - t.t > 600) return;
    if (PS.sel) { PS.sel = null; renderPlaceBoxes(); return; }
    const lr = t.layer.getBoundingClientRect();
    addPlaced(+t.layer.dataset.page, (e.clientX - lr.left) / lr.width, (e.clientY - lr.top) / lr.height);
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-pf-edit]"), del = e.target.closest("[data-pf-del]");
    const doc = activeDoc();
    if (ed) { const f = doc.fields.find((x) => x.id === ed.dataset.pfEdit); if (f) { f._auto = false; openFieldEdit(f.id, true); } }
    if (del) {
      const i = doc.fields.findIndex((x) => x.id === del.dataset.pfDel);
      if (i >= 0) { const [gone] = doc.fields.splice(i, 1); delete doc.values[gone.id]; PS.sel = null; touch(doc); renderPlaceBoxes(); toast("Field removed", "Undo", () => { doc.fields.push(gone); touch(doc); renderPlaceBoxes(); }); }
    }
  });
}

// ------------------------------------------------------------- navigation
function showList(push) {
  S.listMode = true;
  S.activeId = null;
  if (S.editing) { S.editing = false; document.body.classList.remove("editing"); }
  document.body.classList.add("list-mode");
  $("listScreen").classList.remove("hidden");
  $("docScreen").classList.add("hidden");
  $("dock").classList.add("hidden");
  $("barTitle").textContent = "FieldNote";
  $("barSub").textContent = "Turn any PDF into a form";
  $("appHeader").classList.remove("show-title");
  $("sectionNav").innerHTML = "";
  renderList();
  syncHeaderH();
  window.scrollTo(0, 0);
}
function openDoc(id, fromPop) {
  const doc = S.docs.find((d) => d.id === id);
  if (!doc) return;
  S.activeId = id;
  S.listMode = false;
  document.body.classList.remove("list-mode");
  $("listScreen").classList.add("hidden");
  $("docScreen").classList.remove("hidden");
  $("dock").classList.remove("hidden");
  $("docScreen").classList.remove("screen-in");
  void $("docScreen").offsetWidth;
  $("docScreen").classList.add("screen-in", "from-right");
  setSwitch($("flattenToggle"), doc.flatten);
  renderDoc(false);
  syncHeaderH();
  window.scrollTo(0, 0);
  setSaveUi("ok");
  if (!fromPop) { try { history.pushState({ v: "doc" }, ""); } catch (e) {} }
}
async function startFromTemplate(tpl) {
  const copy = JSON.parse(JSON.stringify(Object.assign({}, tpl, { pdf: null })));
  copy.pdf = tpl.pdf.slice();
  copy.id = uid(); copy.isTemplate = false; copy.values = {}; copy.attachments = [];
  copy.createdAt = copy.updatedAt = Date.now();
  copy.name = `${tpl.name} · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  copy.fields.forEach((f) => { if (f.defaultValue !== null && f.defaultValue !== "" && f.defaultValue !== false && !(Array.isArray(f.defaultValue) && !f.defaultValue.length)) copy.values[f.id] = f.defaultValue; });
  S.docs.unshift(copy);
  await dbPut(copy);
  openDoc(copy.id);
}
function cloneDoc(doc, patch) {
  const copy = JSON.parse(JSON.stringify(Object.assign({}, doc, { pdf: null })));
  copy.pdf = doc.pdf.slice();
  Object.assign(copy, { id: uid(), createdAt: Date.now(), updatedAt: Date.now() }, patch);
  return copy;
}
let trash = null;
function deleteDoc(doc) {
  const idx = S.docs.indexOf(doc);
  if (idx < 0) return;
  S.docs.splice(idx, 1);
  if (trash && trash.timer) { clearTimeout(trash.timer); dbDel(trash.doc.id); }
  trash = { doc, idx, timer: setTimeout(() => { dbDel(doc.id); trash = null; }, 6500) };
  if (S.activeId === doc.id) { history.state && history.state.v === "doc" ? history.back() : showList(); }
  else renderList();
  toast(`Deleted “${doc.name}”`, "Undo", () => {
    if (!trash || trash.doc !== doc) return;
    clearTimeout(trash.timer);
    S.docs.splice(Math.min(trash.idx, S.docs.length), 0, doc);
    trash = null;
    renderList();
  });
}
function wireList() {
  $("homeList").addEventListener("click", (e) => {
    const dots = e.target.closest("[data-doc-menu]");
    if (dots) { e.stopPropagation(); return openRowMenu(dots, S.docs.find((d) => d.id === dots.dataset.docMenu)); }
    const row = e.target.closest("[data-open]");
    if (!row) return;
    const doc = S.docs.find((d) => d.id === row.dataset.open);
    if (!doc) return;
    if (doc.isTemplate) startFromTemplate(doc); else openDoc(doc.id);
  });
  $("homeList").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open]")) { e.preventDefault(); e.target.click(); }
  });
  $("docSearch").addEventListener("input", renderList);
}
function openRowMenu(btn, doc) {
  closeRowMenu();
  if (!doc) return;
  const m = document.createElement("div");
  m.className = "job-menu";
  m.id = "rowMenu";
  const items = doc.isTemplate
    ? [["open", "pencil", "Edit template layout"], ["use", "plus", "New form from template"], ["delete", "trash", "Delete"]]
    : [["open", "open", "Open"], ["template", "bookmark", "Save as template"], ["dupe", "copy", "Duplicate"], ["delete", "trash", "Delete"]];
  m.innerHTML = items.map(([k, ic, t]) => `<button type="button" data-act="${k}" ${k === "delete" ? 'style="color:var(--danger)"' : ""}>${icon(ic, "ico")}${t}</button>`).join("");
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = Math.min(innerHeight - m.offsetHeight - 10, r.bottom + 4) + "px";
  m.style.left = Math.max(10, Math.min(innerWidth - m.offsetWidth - 10, r.right - m.offsetWidth)) + "px";
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    closeRowMenu();
    const a = b.dataset.act;
    if (a === "open") openDoc(doc.id);
    else if (a === "use") startFromTemplate(doc);
    else if (a === "delete") deleteDoc(doc);
    else if (a === "dupe") { const c = cloneDoc(doc, { name: doc.name + " copy" }); S.docs.unshift(c); await dbPut(c); renderList(); toast("Duplicated"); }
    else if (a === "template") await makeTemplate(doc);
  });
  setTimeout(() => document.addEventListener("click", closeRowMenu, { once: true }), 0);
}
function closeRowMenu() { const m = $("rowMenu"); if (m) m.remove(); }
async function makeTemplate(doc) {
  const t = cloneDoc(doc, { isTemplate: true, values: {}, attachments: [] });
  S.docs.unshift(t);
  await dbPut(t);
  toast(`Saved “${doc.name}” as a template`);
  if (S.listMode) renderList();
}

// ------------------------------------------------------------- menu + settings + backup
function wireMenus() {
  $("btnDocMore").addEventListener("click", () => { const d = activeDoc(); if (!d) return; setSwitch($("flattenToggle"), d.flatten); openSheet("menuSheet"); });
  const closeM = () => closeSheet("menuSheet");
  $("btnCloseMenu").addEventListener("click", closeM);
  $("menuBack").addEventListener("click", closeM);
  $("btnEditLayout").addEventListener("click", () => { closeM(); setEditing(!S.editing); });
  $("flattenToggle").addEventListener("click", () => { const d = activeDoc(); d.flatten = !d.flatten; setSwitch($("flattenToggle"), d.flatten); touch(d); });
  $("btnSaveTemplate").addEventListener("click", async () => { closeM(); await makeTemplate(activeDoc()); });
  $("btnDupe").addEventListener("click", async () => { closeM(); const c = cloneDoc(activeDoc(), { name: activeDoc().name + " copy" }); S.docs.unshift(c); await dbPut(c); toast("Duplicated"); });
  $("btnClear").addEventListener("click", () => {
    closeM();
    const d = activeDoc();
    const before = d.values, beforeAtt = d.attachments;
    d.values = {}; d.attachments = [];
    d.fields.forEach((f) => { if (f.defaultValue !== null && f.defaultValue !== "" && f.defaultValue !== false) d.values[f.id] = f.defaultValue; });
    touch(d);
    renderDoc(true);
    toast("Answers cleared", "Undo", () => { d.values = before; d.attachments = beforeAtt; touch(d); renderDoc(true); });
  });
  $("btnDelete").addEventListener("click", () => { closeM(); deleteDoc(activeDoc()); });

  $("btnSettings").addEventListener("click", () => openSheet("settingsSheet"));
  const closeS = () => closeSheet("settingsSheet");
  $("btnCloseSettings").addEventListener("click", closeS);
  $("settingsBack").addEventListener("click", closeS);
  $("themeGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-pick]"); if (b) applyTheme(b.dataset.themePick, true); });
  $("motionToggle").addEventListener("click", () => { S.prefs.calm = !S.prefs.calm; savePrefs(); applyMotion(); });
  $("dateFmt").value = S.prefs.dateFmt;
  $("dateFmt").addEventListener("change", () => { S.prefs.dateFmt = $("dateFmt").value; savePrefs(); });

  $("btnBackupAll").addEventListener("click", () => {
    if (!S.docs.length) return toast("Nothing to back up yet");
    const data = { fieldnote: 1, savedAt: new Date().toISOString(), docs: S.docs.map((d) => Object.assign({}, d, { pdf: pdfBytesToDataUrlSafe(d.pdf) })) };
    downloadBlob(JSON.stringify(data), `fieldnote-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    toast("Backup saved");
  });
  $("restorePick").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.docs)) throw new Error("not a backup");
      let n = 0;
      for (const d of data.docs) {
        if (!d.pdf || !d.fields) continue;
        d.pdf = b64ToBytes(d.pdf);
        if (S.docs.some((x) => x.id === d.id)) d.id = uid();
        S.docs.push(d);
        await dbPut(d);
        n++;
      }
      renderList();
      closeS();
      toast(`Restored ${n} form${n === 1 ? "" : "s"}`);
    } catch (err) { toast("That doesn't look like a FieldNote backup"); }
  });
}

// ------------------------------------------------------------- new PDF intake
async function importPdfFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return toast("That isn't a PDF");
  busy("Reading your PDF…");
  try {
    const doc = await createDocFromPdf(file);
    busy(null);
    openDoc(doc.id);
    toast(doc.fields.length ? `Found ${doc.fields.length} field${doc.fields.length === 1 ? "" : "s"}` : "No fillable fields in this PDF");
  } catch (e) {
    console.error(e);
    busy(null);
    toast("Couldn't read that PDF");
  }
}
function wireIntake() {
  $("pdfPick").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importPdfFile(f); });
  ["dragover", "dragenter"].forEach((n) => window.addEventListener(n, (e) => { if (S.listMode && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); const z = $("dropZone"); if (z) z.classList.add("over"); } }));
  ["dragleave", "drop"].forEach((n) => window.addEventListener(n, () => { const z = $("dropZone"); if (z) z.classList.remove("over"); }));
  window.addEventListener("drop", (e) => { if (!S.listMode) return; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); importPdfFile(f); } });
}

// ------------------------------------------------------------- init
async function init() {
  loadPrefs();
  renderThemeGrid();
  applyTheme(S.prefs.theme, false);
  applyMotion();
  wireList(); wireEditor(); wireFieldSheet(); wireSig(); wireReview(); wireMenus(); wireIntake(); wirePlacer();
  $("btnBack").addEventListener("click", () => { if (history.state && history.state.v === "doc") history.back(); else showList(); });
  window.addEventListener("popstate", () => { if (!S.listMode) { if ($("pdfSheet").classList.contains("show")) closeSheet("pdfSheet"); showList(); } });
  document.addEventListener("click", (e) => { const s = e.target.closest("[data-sec]"); if (s) goSection(s.dataset.sec); });
  let raf = 0;
  window.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; onScroll(); }); }, { passive: true });
  window.addEventListener("resize", syncHeaderH);
  window.__fieldnote = { S, analyzePdf, buildPdf, openDoc, importPdfFile };
  showList();
  idb = await openDb();
  try {
    const rows = await dbAll();
    S.docs = (rows || []).concat(S.docs.filter((d) => !(rows || []).some((r) => r.id === d.id))).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) { console.warn(e); }
  if (S.listMode) renderList();
  if (!idb) toast("Saving isn't available here, so forms won't be kept after you close this");
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
