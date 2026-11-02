/* shell.js — shared site shell + helpers (window.AIS). Load with `defer`.
 *
 * Page contract:
 *   <html lang="en" data-root="../" data-page="components">   (data-root: path from this page to the site root; "" for /index.html)
 *   <body> <a class="skip-link" href="#main">Skip to content</a>
 *          <div id="site-header"></div> <main id="main">…</main> <div id="site-footer"></div>
 *
 * Helpers: AIS.root, AIS.url(path), AIS.fetchJSON(path), AIS.esc(str), AIS.highlight(str, query),
 *          AIS.debounce(fn, ms), AIS.tokens(query), AIS.score(query, {title, text}),
 *          AIS.params.get(name) / AIS.params.set({k: v|null}), AIS.PLATFORMS
 */
(function () {
  'use strict';

  var root = document.documentElement.getAttribute('data-root') || '';
  var current = document.documentElement.getAttribute('data-page') || '';

  /* ---------- helpers ---------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function tokens(q) { return String(q || '').toLowerCase().split(/[\s,/]+/).filter(Boolean); }

  /* Every query token must appear in `text`; title hits rank higher. Returns 0 for no match. */
  function score(query, item) {
    var t = tokens(query);
    if (!t.length) return 1;
    var title = String(item.title || '').toLowerCase();
    var text = (title + ' ' + String(item.text || '')).toLowerCase();
    var s = 0;
    for (var i = 0; i < t.length; i++) {
      if (text.indexOf(t[i]) === -1) return 0;
      s += 1;
      if (title.indexOf(t[i]) !== -1) s += 3;
      if (title === t[i]) s += 4;
    }
    return s;
  }

  /* Escapes first, then wraps matches — never injects unescaped input. */
  function highlight(str, query) {
    var safe = esc(str);
    var t = tokens(query).map(function (x) { return esc(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!t.length) return safe;
    return safe.replace(new RegExp('(' + t.join('|') + ')', 'gi'), '<mark>$1</mark>');
  }

  function debounce(fn, ms) {
    var h; return function () { var a = arguments, c = this; clearTimeout(h); h = setTimeout(function () { fn.apply(c, a); }, ms || 120); };
  }

  var cache = {};
  function fetchJSON(path) {
    var u = root + path;
    if (!cache[u]) {
      cache[u] = fetch(u).then(function (r) {
        if (!r.ok) throw new Error(u + ' -> HTTP ' + r.status);
        return r.json();
      });
      cache[u].catch(function () { delete cache[u]; }); // allow retry after a failure
    }
    return cache[u];
  }

  var params = {
    get: function (k) { return new URLSearchParams(location.search).get(k) || ''; },
    set: function (obj) {
      var p = new URLSearchParams(location.search);
      Object.keys(obj).forEach(function (k) { if (obj[k] == null || obj[k] === '') p.delete(k); else p.set(k, obj[k]); });
      var qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  };

  var PLATFORMS = {
    android:      { label: 'Android',       icon: 'assets/android.svg' },
    compose:      { label: 'Jetpack Compose', icon: 'assets/jetpack-compose.svg' },
    ios:          { label: 'iOS',           icon: 'assets/ios.svg' },
    swiftui:      { label: 'SwiftUI',       icon: 'assets/swiftui.svg' },
    react_native: { label: 'React Native',  icon: 'assets/react.svg' },
    flutter:      { label: 'Flutter',       icon: 'assets/flutter.svg' },
    xamarin:      { label: '.NET MAUI',     icon: 'assets/x.svg' },
    ionic:        { label: 'Ionic',         icon: 'assets/ionic.svg' }
  };

  /* ---------- shell ---------- */
  var NAV = [
    { id: 'components',  label: 'Components',  href: 'components/' },
    { id: 'libraries',   label: 'Libraries',   href: 'libraries/' },
    { id: 'equivalents', label: 'Equivalents', href: 'equivalents/' },
    { id: 'blog',        label: 'Blog',        href: 'blog/' }
  ];
  var MORE = [
    { label: 'Knowledge quiz',      href: 'index.html?quiz=1' },
    { label: 'Interview questions', href: 'iqlist.html' },
    { label: 'Game: Catch the Droid', href: 'droid.html' },
    { label: 'Game: Catch the iOS',   href: 'squircle.html' },
    { label: 'Share feedback',      href: 'https://forms.gle/qMAD5hX2VPjahmLAA', ext: true },
    { label: 'Join contributors',   href: 'https://forms.gle/wjcHvYAdYxPHodTN8', ext: true }
  ];

  function link(item) {
    var ext = item.ext ? ' target="_blank" rel="noopener noreferrer"' : '';
    var href = item.ext ? item.href : root + item.href;
    var cur = item.id && item.id === current ? ' aria-current="page"' : '';
    return '<a href="' + esc(href) + '"' + cur + ext + '>' + esc(item.label) + '</a>';
  }

  function renderHeader(el) {
    el.className = 'site-header';
    el.innerHTML =
      '<div class="container">' +
        '<a class="brand" href="' + esc(root || './') + '" aria-label="AI Similarity home"><span>AI</span> Similarity</a>' +
        '<nav class="nav" id="site-nav" aria-label="Primary">' +
          NAV.map(link).join('') +
          '<details><summary>More ▾</summary><div class="menu">' + MORE.map(link).join('') + '</div></details>' +
        '</nav>' +
        '<div class="header-actions">' +
          '<button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle dark mode"></button>' +
          '<button class="icon-btn nav-toggle" id="nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">☰</button>' +
        '</div>' +
      '</div>';

    var tbtn = el.querySelector('#theme-toggle');
    function paint() { tbtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'; }
    paint();
    tbtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('ais-theme', next); } catch (e) { /* ignore */ }
      paint();
    });

    var nav = el.querySelector('#site-nav'), nt = el.querySelector('#nav-toggle');
    nt.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      nt.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      var d = el.querySelector('details');
      if (d && d.open && !d.contains(e.target)) d.open = false;
    });
  }

  function renderFooter(el) {
    el.className = 'site-footer';
    el.innerHTML =
      '<div class="container"><div class="cols">' +
        '<div><strong>AI Similarity</strong><br><span>Cross-platform mobile dictionary: Android ↔ iOS ↔ Flutter ↔ React Native ↔ .NET MAUI ↔ Ionic.</span></div>' +
        '<div>' +
          '<a href="' + esc(root + 'components/') + '">Components</a> · ' +
          '<a href="' + esc(root + 'libraries/') + '">Libraries</a> · ' +
          '<a href="' + esc(root + 'equivalents/') + '">Equivalents</a> · ' +
          '<a href="' + esc(root + 'blog/') + '">Blog</a><br>' +
          '<a href="https://github.com/rahulpahuja/aisimilarity" target="_blank" rel="noopener noreferrer">GitHub</a> · ' +
          '<a href="https://forms.gle/qMAD5hX2VPjahmLAA" target="_blank" rel="noopener noreferrer">Feedback</a> · ' +
          '<a href="https://forms.gle/wjcHvYAdYxPHodTN8" target="_blank" rel="noopener noreferrer">Contribute</a>' +
        '</div>' +
        '<div class="small">Mappings are best-effort; always confirm against the linked official docs.</div>' +
      '</div></div>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var h = document.getElementById('site-header'); if (h) renderHeader(h);
    var f = document.getElementById('site-footer'); if (f) renderFooter(f);
  });

  /* "/" focuses the page search (any element with [data-search]); elsewhere jumps to home search. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    var s = document.querySelector('[data-search]');
    e.preventDefault();
    if (s) { s.focus(); s.select(); } else { location.href = root + 'index.html?focus=search'; }
  });

  window.AIS = { root: root, url: function (p) { return root + p; }, fetchJSON: fetchJSON, esc: esc, highlight: highlight,
                 debounce: debounce, tokens: tokens, score: score, params: params, PLATFORMS: PLATFORMS };
})();
