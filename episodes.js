/**
 * episodes.js — Fem un FaceTime?
 * La pàgina ja porta els episodis escrits a l'HTML (càrrega instantània, SEO).
 * Aquest script comprova si n'hi ha de nous i, només en aquest cas, torna a pintar.
 * Fonts: 1) /api/feed (RSS via Netlify Function)  2) iTunes (JSONP, sense backend)
 */
(function () {
  "use strict";
  var ITUNES = "https://itunes.apple.com/lookup?id=1883933507&entity=podcastEpisode&limit=200&country=es";
  var PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.5l14 7.5-14 7.5V4.5z" fill="currentColor"/></svg>';

  function s(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function summary(t) {
    t = String(t || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return t.length > 220 ? t.slice(0, 217).replace(/\s\S*$/, "") + "…" : t;
  }
  // "Trucada del 24 de juliol de 2026 — Les promeses..." → { call, title }
  function splitTitle(full) {
    var parts = String(full || "").split(/\s+[—–-]\s+/);
    return parts.length > 1 ? { call: parts[0], title: parts.slice(1).join(" — ") } : { call: "", title: full };
  }

  function normalize(list) {
    var total = list.length;
    return list.map(function (ep, i) {
      var t = splitTitle(ep.title);
      return { num: pad(total - i), call: t.call, title: t.title, dur: ep.duration || "",
               desc: summary(ep.description), link: ep.link || "#" };
    });
  }

  function fromFeed() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ctrl) setTimeout(function () { ctrl.abort(); }, 4000);
    return fetch("/api/feed", ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.episodes) || !d.episodes.length) throw 0;
        return normalize(d.episodes);
      });
  }

  function fromItunes() {
    return new Promise(function (resolve, reject) {
      var cb = "__femItunes" + Date.now(), el = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); reject(); }, 6000);
      function cleanup() { clearTimeout(timer); delete window[cb]; el.remove(); }
      window[cb] = function (data) {
        cleanup();
        var eps = (data.results || []).filter(function (r) { return r.kind === "podcast-episode"; })
          .sort(function (a, b) { return new Date(b.releaseDate) - new Date(a.releaseDate); })
          .map(function (r) {
            return { title: r.trackName, description: r.description || r.shortDescription,
                     link: r.trackViewUrl,
                     duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) + " min" : "" };
          });
        eps.length ? resolve(normalize(eps)) : reject();
      };
      el.onerror = function () { cleanup(); reject(); };
      el.src = ITUNES + "&callback=" + cb;
      document.head.appendChild(el);
    });
  }

  function meta(ep) { return [ep.call, ep.dur].filter(Boolean).map(s).join(" · "); }

  function player(ep) {
    if (!/^https:\/\/podcasts\.apple\.com\//.test(ep.link)) {
      return '<div class="latest-card__actions"><a href="' + s(ep.link) + '" class="btn btn--primary btn--sm" target="_blank" rel="noopener noreferrer">' + PLAY + ' Escolta ara</a></div>';
    }
    var src = ep.link.replace("https://podcasts.apple.com", "https://embed.podcasts.apple.com");
    return '<div class="player"><iframe src="' + s(src) + '" title="Reproductor: ' + s(ep.title) + '" height="175" loading="lazy" allow="autoplay *; encrypted-media *; clipboard-write" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation"></iframe></div>';
  }

  function renderLatest(ep, el) {
    el.innerHTML = '<div class="latest-card"><p class="latest-card__ep">Episodi ' + s(ep.num) + '</p>' +
      '<h3 class="t-h2 latest-card__title">' + s(ep.title) + '</h3>' +
      '<p class="latest-card__meta">' + meta(ep) + '</p>' +
      '<p class="latest-card__desc">' + s(ep.desc) + '</p>' +
      player(ep) + '</div>';
  }
  function renderList(eps, el) {
    el.innerHTML = eps.map(function (ep) {
      return '<li><article class="ep-card" aria-labelledby="ep-' + s(ep.num) + '">' +
        '<div class="ep-card__num" aria-hidden="true"><span class="ep-card__num-label">Ep</span><span class="ep-card__num-val">' + s(ep.num) + '</span><div class="ep-card__num-line"></div></div>' +
        '<div class="ep-card__body"><h3 class="ep-card__title" id="ep-' + s(ep.num) + '">' + s(ep.title) + '</h3>' +
        '<p class="ep-card__meta">' + meta(ep) + '</p>' +
        '<p class="ep-card__desc">' + s(ep.desc) + '</p>' +
        '<div class="ep-card__actions"><a href="' + s(ep.link) + '" class="btn btn--secondary btn--sm" target="_blank" rel="noopener noreferrer">' + PLAY + ' Escolta</a></div></div></article></li>';
    }).join("");
  }

  function init() {
    var list = document.querySelector("[data-episode-list]");
    var latest = document.querySelector("[data-latest-episode]");
    var count = document.querySelector("[data-ep-count]");
    if (!list && !latest) return;

    // Episodis que ja hi ha escrits a l'HTML
    var current = list ? list.children.length
      : parseInt((latest.querySelector(".latest-card__ep") || {}).textContent.replace(/\D/g, ""), 10) || 0;

    fromFeed().catch(fromItunes).then(function (eps) {
      if (eps.length <= current) return;           // res de nou: no toquem res
      if (latest) renderLatest(eps[0], latest);
      if (list) renderList(eps, list);
      if (count) count.textContent = eps.length;
    }).catch(function () { /* ens quedem amb l'HTML estàtic */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
