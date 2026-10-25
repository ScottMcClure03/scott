// Shot Finder AI matcher. Runs on Netlify; the Anthropic key stays here, never in the browser.
import library from "../../library.json" with { type: "json" };

const MODEL = "claude-haiku-5-5";
const VIDEOS = library.videos;
const IDS = new Set(VIDEOS.map(v => v.id));

const headers = { "content-type": "application/json", "cache-control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });

// Spam guard: max 20 searches per person per hour (per running instance).
// Normal golfers never get near this; it stops anyone hammering the API.
const LIMIT = 20, WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

export default async (req, context) => {
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  // Over the limit: the page quietly falls back to keyword matching, so the user still gets a result.
  if (tooMany(ip)) return reply(429, { error: "Too many searches, try again later" });

  let text = "";
  try { text = String((await req.json()).text || "").trim().slice(0, 600); } catch { /* fall through */ }
  if (!text) return reply(400, { error: "No shot description" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return reply(500, { error: "AI not configured" });

  const catalogue = VIDEOS
    .filter(v => v.module !== "Tour Secrets")
    .map(v => `${v.id} | ${v.module} | ${v.title} | ${v.keywords}`)
    .join("\n");

  const prompt = `You are the shot finder for Steve Johnston's Short Game Library, a library of short golf videos, each covering one situation around the green. A golfer describes the shot they are facing. Pick the video that best covers it.

Library (id | module | title | keywords):
${catalogue}

Golfer's description: """${text}"""

Rules:
- "best" is the single id that covers this exact situation. If nothing genuinely covers it, set best to null. Do not force a weak match: a bunker shot is not covered by a chipping video, a putt is not covered by a bunker video.
- "alternates": up to 2 other ids that are close, most relevant first. Can be empty.
- "why": one short plain sentence, written to the golfer, saying why this video fits (or, if best is null, what is missing). No jargon, no dashes.
- "request": if best is null, a one line shot request in the golfer's words that Steve could film. Otherwise null.
- Always reply with the JSON object only, even when a rules question (free relief, penalty drop) is involved. You can mention relief briefly in "why".
Return only JSON: {"best": string|null, "alternates": string[], "why": string, "request": string|null}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return reply(502, { error: "AI request failed", status: res.status });

    const data = await res.json();
    const raw = (data.content || []).map(c => c.text || "").join("");
    const json = extractJson(raw);
    // Off-format answer: the page falls back to keyword matching. A snippet is included for debugging.
    if (!json) return reply(502, { error: "AI response could not be read", stop: data.stop_reason, raw: raw.slice(0, 400) });

    const best = json.best && IDS.has(json.best) ? json.best : null;
    const alternates = (Array.isArray(json.alternates) ? json.alternates : [])
      .filter(id => IDS.has(id) && id !== best)
      .slice(0, 2);

    return reply(200, {
      best,
      alternates,
      why: typeof json.why === "string" ? json.why : "",
      request: best ? null : (typeof json.request === "string" ? json.request : null)
    });
  } catch (e) {
    return reply(502, { error: "AI response could not be read" });
  }
};

// Pull the answer object out of the reply, even if the model adds a code fence or a note around it.
function extractJson(raw) {
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { const obj = JSON.parse(raw.slice(start, i + 1)); if (obj && "best" in obj) return obj; } catch { /* try next */ }
        break;
      }
    }
  }
  return null;
}

export const config = { path: "/api/find" };
