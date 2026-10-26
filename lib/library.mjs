// Loads the video list from Steve's Google Sheet, so new videos go live without touching code.
// If the sheet can't be reached, it falls back to the copy bundled with the site (library.json).
import bundled from "../library.json" with { type: "json" };

const SHEET_ID = "1QO-RsP1N2p6IKnOYLYOPh1d59gsDbKNyuT00ur-DO1E";
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const CACHE_MS = 5 * 60 * 1000;

let cache = null, cachedAt = 0;

export async function loadLibrary() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(SHEET_CSV, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) throw new Error("sheet " + res.status);
    const videos = fromCsv(await res.text());
    if (videos.length < 10) throw new Error("sheet looks empty");
    cache = { requestUrl: bundled.requestUrl, videos, source: "sheet" };
  } catch (e) {
    // Keep serving the last good sheet copy if we have one, otherwise the bundled list.
    if (!cache) cache = { requestUrl: bundled.requestUrl, videos: bundled.videos, source: "bundled" };
  }
  cachedAt = Date.now();
  return cache;
}

// Columns are found by their header name, so Steve can't break it by reordering them.
function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  const c = {
    added: col("date added"), module: col("module"), title: col("video title"), url: col("skool link"),
    keywords: col("search words"), by: col("requested by"), club: col("their club"), id: col("id")
  };
  if (c.title < 0 || c.url < 0) return [];
  const get = (r, i) => (i >= 0 && r[i] ? String(r[i]).trim() : "");
  const seen = new Set(), out = [];
  for (const r of rows.slice(1)) {
    const title = get(r, c.title), url = get(r, c.url);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    let id = get(r, c.id) || "v" + hash(url);
    while (seen.has(id)) id += "x";
    seen.add(id);
    out.push({
      id, module: get(r, c.module) || "Other", title, url,
      keywords: get(r, c.keywords),
      added: toIsoDate(get(r, c.added)),
      requestedBy: get(r, c.by), club: get(r, c.club)
    });
  }
  return out;
}

// Accepts 27/10/2026 (UK), 2026-10-27, or 27 Oct 2026. Returns YYYY-MM-DD or "".
function toIsoDate(s) {
  if (!s) return "";
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
