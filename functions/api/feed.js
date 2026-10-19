/**
 * functions/api/feed.js — Cloudflare Pages Function
 * Exposes /api/feed: reads the podcast RSS and returns the episodes as JSON.
 * Set PODCAST_RSS_URL in Cloudflare → Workers & Pages → femunfacetime → Settings → Variables.
 */
function stripHTML(str) {
  return (str || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .trim();
}

function formatDuration(raw) {
  if (!raw) return "";
  if (raw.includes(":")) {
    const parts = raw.split(":");
    if (parts.length === 3) {
      const h = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      return h > 0 ? `${h}h ${m}min` : `${m} min`;
    }
    return `${parseInt(parts[0])} min`;
  }
  const secs = parseInt(raw);
  if (!isNaN(secs)) {
    const m = Math.floor(secs / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}min` : `${m} min`;
  }
  return raw;
}

function formatDate(raw) {
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleDateString("ca-ES", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return raw;
  }
}

function get(item, tag) {
  const cdata = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (cdata) return cdata[1].trim();
  const plain = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return plain ? plain[1].trim() : "";
}

function parseRSS(xml) {
  const items = xml.split("<item>").slice(1);
  return items.map((item, i) => {
    const rawDesc = get(item, "itunes:subtitle") || get(item, "description");
    const description = stripHTML(rawDesc).slice(0, 220).replace(/\s+/g, " ").trim();

    const keywords = get(item, "itunes:keywords");
    const tags = keywords
      ? keywords.split(",").map(k => k.trim()).filter(Boolean).slice(0, 3)
      : [];

    const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);

    return {
      num:       get(item, "itunes:episode") || String(items.length - i).padStart(3, "0"),
      title:     get(item, "title"),
      date:      formatDate(get(item, "pubDate")),
      duration:  formatDuration(get(item, "itunes:duration")),
      description,
      link:      get(item, "link") || "#",
      audioUrl:  enclosureMatch?.[1] || null,
      tags,
    };
  }).filter(ep => ep.title);
}

export async function onRequest({ env }) {
  const rssUrl = env.PODCAST_RSS_URL;
  if (!rssUrl) {
    return Response.json({ error: "PODCAST_RSS_URL not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "FemUnFaceTime/1.0" },
      cf: { cacheTtl: 900, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const episodes = parseRSS(await res.text());
    return Response.json(
      { episodes, updated: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=1800" } }
    );
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
