#!/usr/bin/env node
/**
 * Build: reads the podcast RSS feed and generates
 *   - the episode sections of index.html (between <!--build:*--> markers)
 *   - one page per episode at episodis/<slug>/index.html
 *   - sitemap.xml
 *
 * Usage:
 *   node scripts/build.mjs                 (fetches FEED_URL)
 *   FEED_FILE=path/to/feed.xml node scripts/build.mjs   (local test)
 *
 * No dependencies: runs on plain Node 20+.
 */
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEED_URL = process.env.FEED_URL || "https://anchor.fm/s/110490654/podcast/rss";
const SITE = "https://femunfacetime.com";
const APPLE = "https://podcasts.apple.com/es/podcast/fem-un-facetime/id1883933507";
const SPOTIFY = "https://open.spotify.com/show/7HkJgoiA84MTIlPxl6CT0q";
const EP_DIR = "episodis";

/* ── Helpers ─────────────────────────────────────────── */
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const text = (html) => decode(String(html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`);
  const m = xml.match(re);
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decode(v);
}
const attr = (xml, name, a) => (xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]+)"`)) || [])[1] || "";

const MONTHS = ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"];
function dateCa(d) {
  const m = MONTHS[d.getUTCMonth()];
  return `${d.getUTCDate()} ${/^[aeiou]/.test(m) ? "d'" : "de "}${m} de ${d.getUTCFullYear()}`;
}
const isoDate = (d) => d.toISOString().slice(0, 10);

function minutes(raw) {
  if (!raw) return 0;
  const p = raw.split(":").map(Number);
  const secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : +raw;
  return Math.max(1, Math.round(secs / 60));
}

const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "episodi";

/* Keep only safe, simple formatting from the episode description */
const ALLOWED = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "a"]);
function sanitize(html) {
  return String(html)
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    // links with unsafe targets keep their text but lose the link
    .replace(/<a\b(?![^>]*href\s*=\s*["'](?:https?:|mailto:))[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, t, rest) => {
      t = t.toLowerCase();
      if (!ALLOWED.has(t)) return t === "div" ? (m.startsWith("</") ? "</p>" : "<p>") : "";
      if (m.startsWith("</")) return `</${t}>`;
      if (t === "br") return "<br>";
      if (t === "a") {
        const href = (rest.match(/href\s*=\s*"([^"]*)"/i) || rest.match(/href\s*=\s*'([^']*)'/i) || [])[1] || "";
        if (!/^(https?:|mailto:)/i.test(href)) return "<a>";
        return `<a href="${esc(decode(href))}" target="_blank" rel="noopener noreferrer">`;
      }
      return `<${t}>`;
    })
    .replace(/<p>\s*(<br>\s*)*<\/p>/g, "");
}

function summary(html, max = 210) {
  const first = (String(html).match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || html;
  let s = text(first);
  if (s.length < 60) s = text(html);
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

/* ── Parse feed ──────────────────────────────────────── */
function parse(xml) {
  const items = xml.split(/<item[\s>]/).slice(1).map((chunk) => chunk.split("</item>")[0]);
  const eps = items.map((it) => {
    const full = tag(it, "title");
    const parts = full.split(/\s+[—–]\s+/);
    const call = parts.length > 1 ? parts[0].trim() : "";
    const title = parts.length > 1 ? parts.slice(1).join(" — ").trim() : full.trim();
    const pub = new Date(tag(it, "pubDate"));
    const desc = tag(it, "description") || tag(it, "content:encoded") || tag(it, "itunes:summary");
    return {
      full, call, title, pub,
      num: parseInt(tag(it, "itunes:episode"), 10) || 0,
      min: minutes(tag(it, "itunes:duration")),
      audio: attr(it, "enclosure", "url"),
      audioType: attr(it, "enclosure", "type") || "audio/mpeg",
      guid: tag(it, "guid"),
      descHtml: sanitize(desc),
      summary: summary(desc),
      image: attr(it, "itunes:image", "href"),
    };
  }).filter((e) => e.title && !isNaN(e.pub));

  // chronological order, number missing episodes by position
  eps.sort((a, b) => a.pub - b.pub);
  eps.forEach((e, i) => { if (!e.num) e.num = i + 1; });
  const used = new Set();
  for (const e of eps) {
    let s = slugify(e.title), n = 2;
    while (used.has(s)) s = `${slugify(e.title)}-${n++}`;
    used.add(s);
    e.slug = s;
    e.url = `/${EP_DIR}/${s}/`;
    e.pad = String(e.num).padStart(2, "0");
    e.meta = [e.call, `${e.min} min`].filter(Boolean).join(" · ");
  }
  return eps.reverse(); // newest first
}

/* ── Shared chunks taken from index.html ─────────────── */
const PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.5l14 7.5-14 7.5V4.5z" fill="currentColor"/></svg>';

const player = (e) => `<div class="audio">
            <audio controls preload="none" src="${esc(e.audio)}">
              <a href="${esc(e.audio)}">Descarrega l'episodi</a>
            </audio>
          </div>`;

function latestHtml(e) {
  return `        <div class="latest-card">
          <p class="latest-card__ep">Episodi ${e.pad}</p>
          <h3 class="t-h2 latest-card__title"><a href="${e.url}">${esc(e.title)}</a></h3>
          <p class="latest-card__meta">${esc(e.meta)}</p>
          <p class="latest-card__desc">${esc(e.summary)}</p>
          ${player(e)}
          <a class="latest-card__more" href="${e.url}">Notes de l'episodi <span aria-hidden="true">→</span></a>
        </div>`;
}

function listHtml(eps) {
  return eps.map((e) => `        <li class="ep-item">
          <div class="ep-item__num" aria-hidden="true"><span>Ep</span>${e.pad}</div>
          <article class="ep-card" aria-labelledby="ep-${e.pad}">
            <div class="ep-card__body">
              <h3 class="ep-card__title" id="ep-${e.pad}"><a class="ep-card__link" href="${e.url}">${esc(e.title)}</a></h3>
              <p class="ep-card__meta">${esc(e.meta)}</p>
              <p class="ep-card__desc">${esc(e.summary)}</p>
            </div>
          </article>
        </li>`).join("\n");
}

const PEOPLE = [
  { "@type": "Person", name: "Daniel Morales", sameAs: "https://www.linkedin.com/in/danimoralesfernandez/" },
  { "@type": "Person", name: "Oriol Valentí", sameAs: "https://www.linkedin.com/in/oriolvalentisola/" },
];
const SERIES = {
  "@type": "PodcastSeries", name: "Fem un FaceTime?", url: `${SITE}/`, inLanguage: "ca",
  image: `${SITE}/Show_cover_840.jpg`, author: PEOPLE, sameAs: [APPLE, SPOTIFY],
  description: "Dues persones, una trucada i cap guió. Tecnologia, disseny, cafè, apps i qualsevol cosa que ens passi pel cap, sense presses i sense filtres.",
};
const episodeLd = (e) => ({
  "@type": "PodcastEpisode", episodeNumber: e.num, name: e.title, url: `${SITE}${e.url}`,
  description: e.summary, datePublished: isoDate(e.pub), timeRequired: `PT${e.min}M`,
  associatedMedia: { "@type": "MediaObject", contentUrl: e.audio },
});
const ldScript = (obj) => `  <script type="application/ld+json">\n${JSON.stringify({ "@context": "https://schema.org", ...obj }, null, 2)}\n  </script>`;

const between = (src, name, value) => {
  const re = new RegExp(`(<!--build:${name}-->)[\\s\\S]*?(<!--/build:${name}-->)`);
  if (!re.test(src)) throw new Error(`Marker build:${name} not found in index.html`);
  return src.replace(re, `$1\n${value}\n$2`).replace(`<!--build:count-->\n${value}\n<!--/build:count-->`, `<!--build:count-->${value}<!--/build:count-->`);
};

/* ── Episode page ────────────────────────────────────── */
function episodePage(e, i, eps, chunks) {
  const newer = eps[i - 1], older = eps[i + 1];
  const title = `${e.title} · Episodi ${e.pad} · Fem un FaceTime?`;
  const url = `${SITE}${e.url}`;
  const nav = (x, label, cls) => x ? `<a class="ep-nav__item ${cls}" href="${x.url}"><span class="ep-nav__dir">${label}</span><span class="ep-nav__title">${esc(x.title)}</span></a>` : `<span></span>`;
  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(e.summary)}">
  <link rel="canonical" href="${url}">
  <meta name="author" content="Daniel Morales i Oriol Valentí">
  <meta name="robots" content="index, follow">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121413" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ca_ES">
  <meta property="og:site_name" content="Fem un FaceTime?">
  <meta property="og:title" content="${esc(e.title)}">
  <meta property="og:description" content="${esc(e.summary)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-image.jpg?v=2">
  <meta property="og:image:width" content="2400">
  <meta property="og:image:height" content="1260">
  <meta property="article:published_time" content="${e.pub.toISOString()}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/og-image.jpg?v=2">
${chunks.fonts}
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
  <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css">
${ldScript({ ...episodeLd(e), partOfSeries: { "@type": "PodcastSeries", name: SERIES.name, url: SERIES.url }, author: PEOPLE })}
</head>
<body>

${chunks.header.replace(/href="\/#ultim"/g, 'href="#escolta"').replace("Escolta l'últim episodi", "Escolta aquest episodi")}

<main id="main-content">
  <article class="episode">
    <div class="container">
      <a class="episode__back" href="/#episodis"><span aria-hidden="true">←</span> Tots els episodis</a>
      <p class="episode__eyebrow">Episodi ${e.pad}${e.call ? ` · ${esc(e.call)}` : ""}</p>
      <h1 class="episode__title">${esc(e.title)}</h1>
      <p class="episode__meta">Publicat el ${esc(dateCa(e.pub))} · ${e.min} min</p>

      <div class="episode__player" id="escolta">
        ${player(e)}
        <p class="episode__also">També a
          <a href="${APPLE}" target="_blank" rel="noopener noreferrer">Apple Podcasts</a>
          <a href="${SPOTIFY}" target="_blank" rel="noopener noreferrer">Spotify</a>
        </p>
      </div>

      <section class="episode__notes" aria-labelledby="notes-heading">
        <h2 class="episode__notes-title" id="notes-heading">Notes de l'episodi</h2>
        <div class="prose">
${e.descHtml}
        </div>
      </section>

      <nav class="ep-nav" aria-label="Altres episodis">
        ${nav(older, "← Anterior", "ep-nav__item--prev")}
        ${nav(newer, "Següent →", "ep-nav__item--next")}
      </nav>
    </div>
  </article>
</main>

${chunks.footer}

<script src="/script.js" defer></script>
</body>
</html>
`;
}

/* ── Main ────────────────────────────────────────────── */
async function main() {
  const xml = process.env.FEED_FILE
    ? await readFile(process.env.FEED_FILE, "utf8")
    : await (await fetch(FEED_URL, { headers: { "User-Agent": "femunfacetime.com build" } })).text();
  const eps = parse(xml);
  if (!eps.length) throw new Error("No episodes found in feed — aborting so the site is left untouched.");

  const indexPath = join(ROOT, "index.html");
  let index = await readFile(indexPath, "utf8");

  // index sections
  index = between(index, "latest", latestHtml(eps[0]));
  index = between(index, "list", listHtml(eps.slice(1)));
  index = between(index, "count", String(eps.length));
  index = between(index, "jsonld", ldScript({ ...SERIES, episode: eps.map(episodeLd) }));
  await writeFile(indexPath, index);

  // chunks for episode pages
  const pick = (re, label) => { const m = index.match(re); if (!m) throw new Error(`Missing ${label} in index.html`); return m[0]; };
  const toRoot = (s) => s.replace(/href="#top"/g, 'href="/"').replace(/href="#/g, 'href="/#');
  const chunks = {
    fonts: (index.match(/  <link rel="preconnect"[\s\S]*?<noscript>[\s\S]*?<\/noscript>/) || [""])[0],
    header: toRoot(pick(/<a class="skip-link"[\s\S]*?<\/nav>\s*(?=\n<main)/, "header")),
    footer: pick(/<footer[\s\S]*?<\/footer>/, "footer"),
    listen: pick(/<div class="listen"[\s\S]*?<\/div>(?=\s*<\/div>\s*<div class="hero__cover">)/, "listen buttons"),
  };

  // episode pages: rebuild the folder from scratch
  const dir = join(ROOT, EP_DIR);
  if (existsSync(dir)) await rm(dir, { recursive: true });
  for (const [i, e] of eps.entries()) {
    await mkdir(join(dir, e.slug), { recursive: true });
    await writeFile(join(dir, e.slug, "index.html"), episodePage(e, i, eps, chunks));
  }

  // sitemap
  const urls = [{ loc: `${SITE}/`, lastmod: isoDate(eps[0].pub) },
    ...eps.map((e) => ({ loc: `${SITE}${e.url}`, lastmod: isoDate(e.pub) }))];
  await writeFile(join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join("\n")}\n</urlset>\n`);

  console.log(`Built ${eps.length} episodes:`);
  for (const e of eps) console.log(`  ${e.pad}  ${e.url}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
