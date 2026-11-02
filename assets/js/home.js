/* home.js - discovery hub for index.html: one omnibox over every dataset, quick-lookup chips,
 * data-derived section counts and the latest blog posts. Requires shell.js (window.AIS).
 *
 * Datasets load lazily (first focus / keystroke, or an idle prefetch so the chips and counts can be
 * verified). Each dataset fails independently: a missing file marks that source "unavailable" and
 * is never fatal. All dataset strings reach the DOM through textContent or AIS.highlight (escape-safe).
 */
(function () {
  'use strict';
  var AIS = window.AIS;
  if (!AIS) return;

  /* ---------- config ---------- */
  var COMPOSE_CATEGORIES = [
    'layouts', 'inputs', 'buttons', 'selectors', 'navigation',
    'display', 'accessibility', 'state', 'storage', 'networking',
    'permissions', 'sensors', 'notifications', 'security', 'devtools',
    'utilities', 'platform', 'animations', 'dragdrop', 'text',
    'gestures', 'overlays'
  ]; // keep in sync with CATEGORIES in compose/compose.js

  var TYPES = [
    { id: 'components',  label: 'Components',  single: 'Component',  page: 'components/' },
    { id: 'libraries',   label: 'Libraries',   single: 'Library',    page: 'libraries/' },
    { id: 'equivalents', label: 'Equivalents', single: 'Equivalent', page: 'equivalents/' },
    { id: 'blog',        label: 'Blog',        single: 'Post',       page: 'blog/' }
  ];
  var PF_ORDER = ['android', 'compose', 'ios', 'swiftui', 'react_native', 'flutter', 'xamarin', 'ionic'];
  var QUICK_TERMS = ['Activity', 'RecyclerView', 'Room', 'Retrofit', 'WorkManager', 'LazyColumn'];
  var DROPDOWN_PER_GROUP = 4;
  var INLINE_PER_GROUP = 5;

  /* ---------- dom ---------- */
  function $(id) { return document.getElementById(id); }
  var input = $('omni-input'), popup = $('omni-popup'), listEl = $('omni-list'), footEl = $('omni-foot');
  var statusEl = $('omni-status'), inlineEl = $('omni-results'), chipsWrap = $('quick'), chipsEl = $('quick-chips');
  if (!input || !popup || !listEl) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pfLabel(key) { return (AIS.PLATFORMS[key] && AIS.PLATFORMS[key].label) || key; }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function enc(s) { return encodeURIComponent(s); }

  /* ---------- data ---------- */
  var sets = {};          // type id -> { records, raw, ok, fail }
  var loadPromise = null;
  var loaded = false;

  function resetSets() {
    TYPES.forEach(function (t) { sets[t.id] = { records: [], raw: 0, ok: 0, fail: 0 }; });
  }
  resetSets();

  function settle(path) {
    return AIS.fetchJSON(path).then(function (d) { return { ok: true, data: d }; }, function () { return { ok: false }; });
  }

  function makeRecord(type, title, names, extraText, href, desc) {
    var lc = names.map(function (n) { return n.name.toLowerCase(); });
    return {
      type: type, title: title, names: names, namesLc: lc, desc: desc || '', href: href,
      text: (title + ' ' + names.map(function (n) { return n.name; }).join(' ') + ' ' + extraText).toLowerCase()
    };
  }

  /* Components: compose/*.json (compose + swiftui + cross-platform) merged with the classic Views/UIKit dataset by name. */
  function buildComponents(composeResults, classicResult) {
    var byTitle = {}, order = [], s = sets.components;
    function add(item, category) {
      if (!item || typeof item !== 'object') return;
      var title = str(item.component);
      if (!title) return;
      s.raw++;
      var key = title.toLowerCase(), rec = byTitle[key];
      if (!rec) { rec = byTitle[key] = { title: title, names: {}, cats: {} }; order.push(key); }
      PF_ORDER.forEach(function (k) {
        var v = str(item[k]);
        if (v && !rec.names[k]) rec.names[k] = v;
      });
      if (category) rec.cats[category] = true;
    }
    composeResults.forEach(function (r, i) {
      if (!r.ok) { s.fail++; return; }
      var items = r.data && (Array.isArray(r.data.items) ? r.data.items : Array.isArray(r.data) ? r.data : null);
      if (!items) { s.fail++; return; }
      s.ok++;
      items.forEach(function (it) { add(it, COMPOSE_CATEGORIES[i]); });
    });
    if (!classicResult.ok) s.fail++;
    else {
      var groups = classicResult.data && classicResult.data.groups;
      if (!Array.isArray(groups)) s.fail++;
      else {
        s.ok++;
        groups.forEach(function (g) {
          (g && Array.isArray(g.items) ? g.items : []).forEach(function (it) { add(it, g.label); });
        });
      }
    }
    s.records = order.map(function (key) {
      var r = byTitle[key];
      var names = PF_ORDER.filter(function (k) { return r.names[k]; }).map(function (k) { return { key: k, name: r.names[k] }; });
      return makeRecord('components', r.title, names, Object.keys(r.cats).join(' '), AIS.url('components/?q=' + enc(r.title)));
    });
  }

  function platformNames(obj) {
    var names = [], extra = [];
    PF_ORDER.forEach(function (k) {
      var p = obj && obj[k];
      var name = p && typeof p === 'object' ? str(p.name) : str(p);
      if (name) names.push({ key: k, name: name });
      if (p && typeof p === 'object' && str(p.install)) extra.push(str(p.install));
    });
    return { names: names, extra: extra.join(' ') };
  }

  function buildLibraries(results) {
    var s = sets.libraries, seen = {};
    results.forEach(function (r) {
      if (!r.ok || !r.data || !Array.isArray(r.data.items)) { s.fail++; return; }
      s.ok++;
      r.data.items.forEach(function (it) {
        var title = it && str(it.title);
        if (!title) return;
        s.raw++;
        var pn = platformNames(it.platforms);
        var tags = Array.isArray(it.tags) ? it.tags.join(' ') : '';
        var builtin = it.builtin && typeof it.builtin === 'object' ? Object.keys(it.builtin).map(function (k) { return it.builtin[k]; }).join(' ') : '';
        var id = (str(it.id) || title.toLowerCase());
        if (seen[id]) return;
        seen[id] = true;
        s.records.push(makeRecord('libraries', title, pn.names, [str(it.description), tags, pn.extra, builtin].join(' '),
          AIS.url('libraries/?q=' + enc(title)), str(it.description)));
      });
    });
  }

  function buildEquivalents(result) {
    var s = sets.equivalents;
    if (!result.ok || !result.data || !Array.isArray(result.data.items)) { s.fail++; return; }
    s.ok++;
    result.data.items.forEach(function (it) {
      var title = it && str(it.title);
      if (!title) return;
      s.raw++;
      var pn = platformNames(it);
      var tags = Array.isArray(it.tags) ? it.tags.join(' ') : '';
      s.records.push(makeRecord('equivalents', title, pn.names, [str(it.notes), tags, str(it.category)].join(' '),
        AIS.url('equivalents/?q=' + enc(title)), str(it.notes)));
    });
  }

  function postTime(p) { var t = Date.parse(p.date); return isNaN(t) ? 0 : t; }

  function buildBlog(result) {
    var s = sets.blog;
    var list = result.ok && result.data ? (Array.isArray(result.data) ? result.data : (result.data.posts || result.data.items)) : null;
    if (!Array.isArray(list)) { s.fail++; return; }
    s.ok++;
    var posts = list.filter(function (p) { return p && str(p.title) && /^[A-Za-z0-9_-]+$/.test(str(p.slug)); });
    s.raw = posts.length;
    s.posts = posts.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      return (postTime(b.p) - postTime(a.p)) || ((Number(a.p.order) || 0) - (Number(b.p.order) || 0)) || (a.i - b.i);
    }).map(function (x) { return x.p; });
    s.records = s.posts.map(function (p) {
      var tags = Array.isArray(p.tags) ? p.tags.join(' ') : '';
      return makeRecord('blog', str(p.title), [], [str(p.summary), tags, str(p.category)].join(' '),
        AIS.url('blog/' + str(p.slug) + '.html'), str(p.summary));
    });
  }

  function loadAll() {
    if (loadPromise) return loadPromise;
    resetSets();
    var composeP = Promise.all(COMPOSE_CATEGORIES.map(function (c) { return settle('compose/' + c + '.json'); }));
    loadPromise = Promise.all([
      composeP, settle('data/components-classic.json'),
      settle('data/libraries-ui.json'), settle('data/libraries-deps.json'),
      settle('data/equivalents.json'), settle('blog/posts.json')
    ]).then(function (r) {
      var builders = [
        function () { buildComponents(r[0], r[1]); },
        function () { buildLibraries([r[2], r[3]]); },
        function () { buildEquivalents(r[4]); },
        function () { buildBlog(r[5]); }
      ];
      builders.forEach(function (b, i) {
        try { b(); } catch (err) { sets[TYPES[i].id].ok = 0; sets[TYPES[i].id].records = []; }  // unexpected shape: treat as unavailable
      });
      loaded = true;
      afterLoad();
    });
    return loadPromise;
  }

  function unavailableTypes() {
    return TYPES.filter(function (t) { return sets[t.id].ok === 0; });
  }
  function partialTypes() {
    return TYPES.filter(function (t) { return sets[t.id].ok > 0 && sets[t.id].fail > 0; });
  }

  /* ---------- search ---------- */
  function scoreRecord(q, rec) {
    var base = AIS.score(q, { title: rec.title, text: rec.text });
    if (!base) return 0;
    var toks = AIS.tokens(q), bonus = 0;
    toks.forEach(function (t) {
      rec.namesLc.forEach(function (n) {
        if (n === t) bonus += 5; else if (n.indexOf(t) !== -1) bonus += 2;
      });
    });
    return base + (bonus > 0 ? Math.min(bonus, 8) : 0);
  }

  function search(q) {
    var toks = AIS.tokens(q), out = {}, total = 0;
    TYPES.forEach(function (t) {
      var hits = [];
      sets[t.id].records.forEach(function (rec) {
        var s = scoreRecord(q, rec);
        if (s) hits.push({ rec: rec, s: s });
      });
      hits.sort(function (a, b) { return (b.s - a.s) || a.rec.title.localeCompare(b.rec.title); });
      out[t.id] = hits.map(function (h) { return h.rec; });
      total += hits.length;
    });
    return { q: q, toks: toks, groups: out, total: total };
  }

  /* ---------- rendering ---------- */
  function matchedNames(rec, toks) {
    var m = rec.names.filter(function (n, i) {
      return toks.some(function (t) { return rec.namesLc[i].indexOf(t) !== -1; });
    });
    if (!m.length) m = rec.names.slice(0, 3);
    return m.slice(0, 4);
  }

  function buildItem(rec, q, toks, opts) {
    var a = el('a', opts.cls);
    a.href = rec.href;
    if (opts.id) { a.id = opts.id; a.setAttribute('role', 'option'); a.setAttribute('aria-selected', 'false'); a.tabIndex = -1; }
    var top = el('span', 'omni-top');
    var title = el('span', 'omni-title');
    title.innerHTML = AIS.highlight(rec.title, q);
    top.appendChild(title);
    var type = el('span', 'omni-type', TYPES.filter(function (t) { return t.id === rec.type; })[0].single);
    top.appendChild(type);
    a.appendChild(top);

    if (rec.type === 'blog') {
      if (rec.desc) a.appendChild(el('span', 'omni-desc', rec.desc));
    } else {
      var meta = el('span', 'omni-meta');
      matchedNames(rec, toks).forEach(function (n) {
        var g = el('span', 'omni-pf');
        g.appendChild(el('span', 'pf pf-' + n.key, pfLabel(n.key)));
        var nm = el('span', 'omni-pfname');
        nm.innerHTML = AIS.highlight(n.name, q);
        g.appendChild(nm);
        meta.appendChild(g);
      });
      if (meta.childNodes.length) a.appendChild(meta);
    }
    return a;
  }

  function unavailableNote(withRetry) {
    var bad = unavailableTypes(), part = partialTypes();
    if (!bad.length && !part.length) return null;
    var p = el('p', 'omni-note');
    var msg = [];
    if (bad.length) msg.push('Unavailable right now: ' + bad.map(function (t) { return t.label; }).join(', ') + '.');
    if (part.length) msg.push('Some data failed to load for: ' + part.map(function (t) { return t.label; }).join(', ') + '.');
    p.appendChild(document.createTextNode(msg.join(' ') + ' '));
    if (withRetry) {
      var b = el('button', 'omni-retry', 'Retry');
      b.type = 'button';
      b.addEventListener('click', retryLoad);
      p.appendChild(b);
    }
    return p;
  }

  function retryLoad() {
    loadPromise = null; loaded = false;
    loadAll().then(function () {
      var q = input.value.trim();
      if (inlineMode) showInline(q); else if (q) renderPopup(q);
    });
  }

  /* dropdown (combobox popup) */
  var options = [], active = -1, seq = 0, popupOpen = false;

  function setActive(i) {
    if (active >= 0 && options[active]) { options[active].setAttribute('aria-selected', 'false'); options[active].classList.remove('is-active'); }
    active = i;
    if (i >= 0 && options[i]) {
      options[i].setAttribute('aria-selected', 'true');
      options[i].classList.add('is-active');
      input.setAttribute('aria-activedescendant', options[i].id);
      options[i].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function openPopup(on) {
    popupOpen = on;
    popup.hidden = !on;
    input.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) setActive(-1);
  }

  function say(msg) { if (statusEl) statusEl.textContent = msg; }

  function renderPopup(q) {
    var mySeq = ++seq;
    listEl.textContent = '';
    footEl.textContent = '';
    options = []; active = -1; input.removeAttribute('aria-activedescendant');
    if (!loaded) {
      listEl.appendChild(el('div', 'omni-msg', 'Loading search index…'));
      openPopup(true);
      say('Loading search index');
      loadAll().then(function () { if (mySeq === seq && input.value.trim() === q) renderPopup(q); });
      return;
    }
    var res = search(q), n = 0;
    TYPES.forEach(function (t) {
      var hits = res.groups[t.id];
      if (!hits.length) return;
      var gid = 'omni-g-' + t.id;
      var g = el('div', 'omni-group');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-labelledby', gid);
      var h = el('div', 'omni-group-label', t.label + ' · ' + hits.length);
      h.id = gid;
      g.appendChild(h);
      hits.slice(0, DROPDOWN_PER_GROUP).forEach(function (rec) {
        var item = buildItem(rec, q, res.toks, { cls: 'omni-opt', id: 'omni-opt-' + (n++) });
        options.push(item);
        g.appendChild(item);
      });
      listEl.appendChild(g);
    });
    if (!res.total) listEl.appendChild(el('div', 'omni-msg', 'No matches for “' + q + '”.'));
    var hint = el('div', 'omni-hint', res.total ? 'Press Enter to see all ' + res.total + ' results \u00b7 Up/Down to browse \u00b7 Esc to close' : 'Press Enter for tips');
    footEl.appendChild(hint);
    var note = unavailableNote(true);
    if (note) footEl.appendChild(note);
    openPopup(true);
    say(res.total ? res.total + ' results. Use up and down arrows to review.' : 'No results');
  }

  /* inline "see all results" view */
  var inlineMode = false;

  function showInline(q) {
    inlineMode = true;
    openPopup(false);
    inlineEl.hidden = false;
    inlineEl.textContent = '';
    if (!q) { hideInline(); return; }
    if (!loaded) {
      inlineEl.appendChild(el('p', 'muted', 'Loading search index…'));
      loadAll().then(function () { if (inlineMode && input.value.trim() === q) showInline(q); });
      return;
    }
    var res = search(q);
    AIS.params.set({ q: q });
    var head = el('p', 'result-count');
    head.setAttribute('aria-live', 'polite');
    head.textContent = res.total + (res.total === 1 ? ' result for “' : ' results for “') + q + '”';
    inlineEl.appendChild(head);
    say(head.textContent);

    if (!res.total) {
      var empty = el('div', 'empty-state');
      empty.appendChild(el('p', null, 'Nothing matched “' + q + '”.'));
      empty.appendChild(el('p', 'small', 'Try a platform-specific name (for example UILabel, Retrofit, LazyColumn) or fewer words.'));
      var clear = el('button', 'btn', 'Clear search');
      clear.type = 'button';
      clear.addEventListener('click', function () { clearSearch(true); });
      empty.appendChild(clear);
      inlineEl.appendChild(empty);
    }

    TYPES.forEach(function (t) {
      var hits = res.groups[t.id];
      if (!hits.length) return;
      var sec = el('section', 'res-group');
      var h = el('h2', null, t.label);
      h.appendChild(el('span', 'res-count', String(hits.length)));
      sec.appendChild(h);
      var ul = el('ul', 'res-list');
      hits.slice(0, INLINE_PER_GROUP).forEach(function (rec) {
        var li = document.createElement('li');
        li.appendChild(buildItem(rec, q, res.toks, { cls: 'res-item' }));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      var more = el('a', 'res-more', 'See all ' + hits.length + ' in ' + t.label + ' →');
      more.href = AIS.url(t.page + '?q=' + enc(q));
      sec.appendChild(more);
      inlineEl.appendChild(sec);
    });
    var note = unavailableNote(true);
    if (note) inlineEl.appendChild(note);
  }

  function hideInline() {
    inlineMode = false;
    inlineEl.hidden = true;
    inlineEl.textContent = '';
  }

  function clearSearch(focus) {
    input.value = '';
    hideInline();
    openPopup(false);
    AIS.params.set({ q: null });
    say('');
    if (focus) input.focus();
  }

  /* ---------- input events ---------- */
  var onType = AIS.debounce(function () {
    var q = input.value.trim();
    if (inlineMode) { hideInline(); AIS.params.set({ q: null }); }
    if (!q) { openPopup(false); say(''); return; }
    renderPopup(q);
  }, 80);

  input.addEventListener('input', function () { loadAll(); onType(); });
  input.addEventListener('focus', function () {
    loadAll();
    var q = input.value.trim();
    if (q && !inlineMode && !popupOpen) renderPopup(q);
  });

  input.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!popupOpen) {
        var q0 = input.value.trim();
        if (!q0) return;
        e.preventDefault();
        renderPopup(q0);
        return;
      }
      if (!options.length) return;
      e.preventDefault();
      var next = k === 'ArrowDown' ? active + 1 : active - 1;
      if (next >= options.length) next = -1;           // wrap through "no selection"
      else if (next < -1) next = options.length - 1;
      setActive(next);
    } else if (k === 'Enter') {
      var q = input.value.trim();
      if (popupOpen && active >= 0 && options[active]) {
        e.preventDefault();
        location.href = options[active].href;
      } else if (q) {
        e.preventDefault();
        showInline(q);
      }
    } else if (k === 'Escape') {
      if (popupOpen) { e.preventDefault(); openPopup(false); }
      else if (input.value) { e.preventDefault(); clearSearch(false); }
    } else if (k === 'Tab') {
      openPopup(false);
    } else if (k === 'Home' && popupOpen && active >= 0) {
      e.preventDefault(); setActive(0);
    } else if (k === 'End' && popupOpen && active >= 0) {
      e.preventDefault(); setActive(options.length - 1);
    }
  });

  /* keep focus in the input while interacting with the popup with a mouse */
  popup.addEventListener('mousedown', function (e) { e.preventDefault(); });
  document.addEventListener('click', function (e) {
    if (popupOpen && !popup.contains(e.target) && e.target !== input) openPopup(false);
  });
  var form = input.form;
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });

  /* ---------- chips, counts, latest posts ---------- */
  function afterLoad() {
    renderChips();
    renderCounts();
    renderLatest();
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.textContent = '';
    QUICK_TERMS.forEach(function (term) {
      if (!search(term).total) return;       // only terms that actually exist in the loaded data
      var b = el('button', 'chip', term);
      b.type = 'button';
      b.addEventListener('click', function () { runSearch(term); });
      chipsEl.appendChild(b);
    });
    if (chipsWrap) chipsWrap.hidden = !chipsEl.childNodes.length;
  }

  var COUNT_NOUN = { components: ['component', 'components'], libraries: ['library', 'libraries'], equivalents: ['mapping', 'mappings'], blog: ['post', 'posts'] };

  function renderCounts() {
    TYPES.forEach(function (t) {
      var node = document.querySelector('[data-count="' + t.id + '"]');
      if (!node) return;
      var s = sets[t.id];
      if (!s.ok || !s.raw) { node.hidden = true; node.textContent = ''; return; }
      node.textContent = s.raw + ' ' + COUNT_NOUN[t.id][s.raw === 1 ? 0 : 1];
      node.hidden = false;
    });
  }

  function renderLatest() {
    var sec = $('latest'), box = $('latest-list');
    if (!sec || !box) return;
    var posts = (sets.blog.posts || []).slice(0, 3);
    box.textContent = '';
    if (!posts.length) { sec.hidden = true; return; }
    posts.forEach(function (p) {
      var a = el('a', 'card post-card');
      a.href = AIS.url('blog/' + str(p.slug) + '.html');
      var meta = el('span', 'post-meta');
      if (str(p.category)) meta.appendChild(el('span', 'badge', str(p.category)));
      if (str(p.date)) {
        var d = el('time', 'small muted', str(p.date));
        d.setAttribute('datetime', str(p.date));
        meta.appendChild(d);
      }
      a.appendChild(meta);
      a.appendChild(el('h3', null, str(p.title)));
      if (str(p.summary)) a.appendChild(el('p', 'muted small', str(p.summary)));
      box.appendChild(a);
    });
    sec.hidden = false;
  }

  /* ---------- public API (used by index.js and chips) ---------- */
  function runSearch(q) {
    input.value = q;
    input.focus({ preventScroll: true });
    showInline(q.trim());
    var top = inlineEl.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.8) inlineEl.scrollIntoView({ block: 'start' });
  }

  window.AISHome = {
    focus: function () { input.focus(); input.select(); },
    run: runSearch
  };

  /* ---------- prefetch so chips/counts/latest can be derived ---------- */
  function prefetch() {
    var c = navigator.connection;
    if (c && c.saveData) return;
    loadAll();
  }
  if ('requestIdleCallback' in window) {
    window.addEventListener('load', function () { requestIdleCallback(prefetch, { timeout: 2500 }); });
  } else {
    window.addEventListener('load', function () { setTimeout(prefetch, 800); });
  }
})();
