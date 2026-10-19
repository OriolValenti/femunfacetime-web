/* =============================================
   On Screen — script.js
   Minimal JS: mobile nav + active links
   ============================================= */

(function () {
  'use strict';

  // ── Mobile nav toggle ──────────────────────
  var hamburger = document.querySelector('.nav__hamburger');
  var mobileNav = document.getElementById('mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function () {
      var isOpen = mobileNav.classList.contains('is-open');
      mobileNav.classList.toggle('is-open');
      hamburger.setAttribute('aria-expanded', String(!isOpen));
      document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('is-open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('is-open')) {
        mobileNav.classList.remove('is-open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        hamburger.focus();
      }
    });
  }

  // ── Mark active nav item ──────────────────
  var page = window.location.pathname.split('/').pop() || 'index.html';
  // Handle root path
  if (page === '' || page === '/') page = 'index.html';

  document.querySelectorAll('.nav__links a, .nav__mobile a').forEach(function (a) {
    var href = a.getAttribute('href');
    // Strip hash from href for comparison
    var hrefPage = href ? href.split('#')[0] : '';
    if (hrefPage === page || (page === 'index.html' && hrefPage === './')) {
      a.setAttribute('aria-current', 'page');
    }
  });

  // ── Fake audio player ────────────────────
  var playBtn = document.querySelector('.audio-player__btn');
  var playIcon = document.getElementById('play-icon');
  var pauseIcon = document.getElementById('pause-icon');

  if (playBtn && playIcon && pauseIcon) {
    var playing = false;
    pauseIcon.style.display = 'none';

    playBtn.addEventListener('click', function () {
      playing = !playing;
      if (playing) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = '';
        playBtn.setAttribute('aria-label', 'Pause episode');
        // REPLACE: Wire up your actual audio player here
        // e.g. audioElement.play();
      } else {
        pauseIcon.style.display = 'none';
        playIcon.style.display = '';
        playBtn.setAttribute('aria-label', 'Play episode');
        // REPLACE: audioElement.pause();
      }
    });
  }

  // ── Newsletter form (UI only) ────────────
  var newsletterForm = document.getElementById('newsletter-form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = newsletterForm.querySelector('input[type="email"]');
      var msg = document.getElementById('newsletter-msg');
      if (input && input.value && msg) {
        msg.textContent = 'Thanks! We\'ll be in touch soon. 👋';
        msg.style.color = 'var(--green-hover)';
        input.value = '';
      }
    });
  }
})();

/* Hero 3D tilt: follows the pointer on devices with a mouse; off for touch and reduced motion */
(function () {
  var t = document.querySelector("[data-tilt]");
  if (!t || !window.matchMedia) return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var frame = 0;
  t.addEventListener("pointermove", function (e) {
    var r = t.getBoundingClientRect();
    var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    var y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      t.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg");
      t.style.setProperty("--rx", ((0.5 - y) * 10).toFixed(2) + "deg");
      t.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
      t.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
      t.classList.add("is-active");
    });
  });
  t.addEventListener("pointerleave", function () {
    cancelAnimationFrame(frame);
    t.classList.remove("is-active");
    t.style.setProperty("--rx", "0deg");
    t.style.setProperty("--ry", "0deg");
  });
})();
