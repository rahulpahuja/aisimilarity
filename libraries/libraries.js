/* libraries.js — cross-platform library finder. Depends on window.AIS (assets/js/shell.js). */
(function () {
  'use strict';

  var A = window.AIS;
  var $ = function (id) { return document.getElementById(id); };

  var SOURCES = {
    ui:   { path: 'data/libraries-ui.json',   label: 'UI component libraries' },
    deps: { path: 'data/libraries-deps.json', label: 'Dependencies' }
  };
  var TABS = ['all', 'ui', 'deps'];
  var ORDER = ['android', 'ios', 'flutter', 'react_native', 'ionic', 'xamarin'];
  var UI_LABELS = {
    compose: 'Compose', views: 'Views', swiftui: 'SwiftUI', uikit: 'UIKit',
    both: { android: 'Compose + Views', ios: 'SwiftUI + UIKit' }
  };
  var CARD_CHUNK = 36;
  var ROW_CHUNK = 60;

  var state = { tab: 'all', q: '', cat: '', translate: false, from: 'android', to: 'ios', shown: 0 };
  var loaded = { ui: null, deps: null };   // prepared source objects
  var failed = { ui: null, deps: null };   // Error per source
  var current = [];                        // current filtered record list
  var loadToken = 0;

  function plabel(k) { return (A.PLATFORMS[k] && A.PLATFORMS[k].label) || k; }

  /* ---------- data preparation ---------- */
  function prepare(key, data) {
    var cats = {}, catList = [];
    (data.categories || []).forEach(function (c) {
      if (c && c.id && !cats[c.id]) { cats[c.id] = c.label || c.id; catList.push({ id: c.id, label: c.label || c.id }); }
    });
    var records = (data.items || []).map(function (it) {
      var plats = [];
      ORDER.forEach(function (k) {
        var e = it.platforms && it.platforms[k];
        if (e && e.name) plats.push(k);
      });
      var names = plats.map(function (k) { return it.platforms[k].name; }).join(' ');
      var bits = [it.id, it.description, (it.tags || []).join(' '), cats[it.category] || it.category];
      plats.forEach(function (k) { bits.push(it.platforms[k].install || ''); });
      Object.keys(it.builtin || {}).forEach(function (k) { bits.push(it.builtin[k] || ''); });
      if (!cats[it.category]) { cats[it.category] = it.category; catList.push({ id: it.category, label: it.category }); }
      return { src: key, item: it, plats: plats, title: (it.title || '') + ' ' + names, text: bits.join(' ') };
    });
    return { key: key, meta: data.meta || {}, cats: cats, catList: catList, records: records };
  }

  function loadSource(key) {
    return A.fetchJSON(SOURCES[key].path).then(function (data) {
      loaded[key] = prepare(key, data); failed[key] = null;
    }).catch(function (err) {
      loaded[key] = null; failed[key] = err || new Error('failed');
    });
  }

  function neededKeys(tab) { return tab === 'all' ? ['ui', 'deps'] : [tab]; }

  function ensure(tab) {
    return Promise.all(neededKeys(tab).filter(function (k) { return !loaded[k]; }).map(loadSource));
  }

  /* ---------- helpers ---------- */
  function safeUrl(u) {
    try {
      var x = new URL(String(u), location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null;
    } catch (e) { return null; }
  }

  function copyValue(install) {
    var m = /^(\S.*?)\s+\([^()]*\)$/.exec(install);   // drop a trailing note such as "(Swift Package Manager)"
    return m ? m[1] : install;
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function flash(btn, text) {
    var orig = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', orig);
    btn.textContent = text;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = orig; }, 1600);
  }

  function uiTag(entry, pk) {
    var v = entry.ui; if (!v) return '';
    var label = v === 'both' ? UI_LABELS.both[pk] : UI_LABELS[v];
    if (!label) return '';
    return '<span class="badge lib-ui" title="UI toolkit this library targets">' + A.esc(label) + '</span>';
  }

  function statusBadge(entry) {
    if (entry.status === 'deprecated') return '<span class="badge warn">Deprecated</span>';
    if (entry.status === 'archived') return '<span class="badge warn">Archived</span>';
    return '';
  }

  function builtinHtml(item, pk, withLabel) {
    var b = item.builtin && item.builtin[pk];
    if (!b) return '';
    return '<p class="lib-builtin">' + (withLabel ? '<span class="pf pf-' + A.esc(pk) + '">' + A.esc(plabel(pk)) + '</span> ' : '') +
      '<strong>Built in:</strong> ' + A.highlight(b, state.q) + '</p>';
  }

  /* One library entry: name link, tags, install + copy. `showPf` prefixes a platform label. */
  function entryHtml(rec, pk, showPf) {
    var e = rec.item.platforms[pk];
    var href = e.url ? safeUrl(e.url) : null;
    var nm = A.highlight(e.name, state.q);
    var name = href
      ? '<a class="lib-name" href="' + A.esc(href) + '" target="_blank" rel="noopener noreferrer">' + nm + '</a>'
      : '<span class="lib-name">' + nm + '</span>';
    var head = '<div class="lib-entry-head">' +
      (showPf ? '<span class="pf pf-' + A.esc(pk) + '">' + A.esc(plabel(pk)) + '</span>' : '') +
      name + uiTag(e, pk) + statusBadge(e) + '</div>';
    var inst = '';
    if (e.install && /^built[\s-]?in/i.test(e.install)) {
      inst = '<p class="lib-builtin">' + A.highlight(e.install, state.q) + '</p>';
    } else if (e.install) {
      inst = '<div class="lib-install"><code>' + A.highlight(e.install, state.q) + '</code>' +
        '<button type="button" class="btn lib-copy" data-copy="' + A.esc(copyValue(e.install)) + '" aria-label="Copy install line for ' +
        A.esc(e.name) + ' (' + A.esc(plabel(pk)) + ')">Copy</button></div>';
    }
    return head + inst;
  }

  /* ---------- filtering ---------- */
  function sources() { return neededKeys(state.tab).filter(function (k) { return loaded[k]; }).map(function (k) { return loaded[k]; }); }

  /* Records after tab, translate and search (but before category). */
  function baseList() {
    var out = [], n = 0;
    sources().forEach(function (s) {
      s.records.forEach(function (r) {
        if (state.translate && r.plats.indexOf(state.from) === -1) return;
        var sc = A.score(state.q, { title: r.title, text: r.text });
        if (sc > 0) out.push({ r: r, s: sc, n: n++ });
      });
    });
    if (A.tokens(state.q).length) out.sort(function (a, b) { return b.s - a.s || a.n - b.n; });
    return out.map(function (x) { return x.r; });
  }

  function categoryList() {
    var seen = {}, out = [];
    sources().forEach(function (s) {
      s.catList.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    });
    return out;
  }

  function catLabel(rec) { var s = loaded[rec.src]; return (s && s.cats[rec.item.category]) || rec.item.category; }

  /* ---------- rendering ---------- */
  function cardHtml(rec) {
    var it = rec.item;
    var plats = rec.plats.map(function (k) {
      return '<li>' + entryHtml(rec, k, true) + builtinHtml(it, k, false) + '</li>';
    }).join('');
    // builtin-only platforms (no library entry) still deserve a note
    var extra = Object.keys(it.builtin || {}).filter(function (k) { return rec.plats.indexOf(k) === -1 && it.builtin[k]; })
      .map(function (k) { return '<li>' + builtinHtml(it, k, true) + '</li>'; }).join('');
    var tags = (it.tags || []).map(function (t) {
      return '<button type="button" class="lib-tag" data-tag="' + A.esc(t) + '">' + A.highlight(t, state.q) + '</button>';
    }).join('');
    return '<article class="card lib-card">' +
      '<div class="lib-card-head"><h3>' + A.highlight(it.title, state.q) + '</h3><span class="badge">' + A.esc(catLabel(rec)) + '</span></div>' +
      (it.description ? '<p class="lib-desc">' + A.highlight(it.description, state.q) + '</p>' : '') +
      '<ul class="lib-pfs">' + plats + extra + '</ul>' +
      (tags ? '<div class="lib-tags">' + tags + '</div>' : '') +
      '</article>';
  }

  function rowHtml(rec) {
    var it = rec.item, from = state.from, to = state.to;
    var left = '<div class="lib-job">' + A.highlight(it.title, state.q) + '<span class="badge">' + A.esc(catLabel(rec)) + '</span></div>' +
      entryHtml(rec, from, false) + builtinHtml(it, from, false) +
      (it.description ? '<p class="lib-row-desc">' + A.highlight(it.description, state.q) + '</p>' : '');
    var right;
    if (rec.plats.indexOf(to) !== -1) right = entryHtml(rec, to, false) + builtinHtml(it, to, false);
    else right = '<span class="lib-none">No ' + A.esc(plabel(to)) + ' library listed.</span>' + builtinHtml(it, to, false);
    return '<tr><td>' + left + '</td><td>' + right + '</td></tr>';
  }

  function chunkSize() { return state.translate ? ROW_CHUNK : CARD_CHUNK; }

  function renderResults() {
    var host = $('results'), more = $('more');
    var list = current;
    host.setAttribute('aria-busy', 'false');
    if (!list.length) {
      more.hidden = true;
      host.innerHTML = emptyHtml();
      return;
    }
    state.shown = Math.min(chunkSize(), list.length);
    var slice = list.slice(0, state.shown);
    if (state.translate) {
      host.innerHTML = '<div class="table-wrap lib-table"><table class="data"><caption class="sr-only">Libraries on ' + A.esc(plabel(state.from)) +
        ' and their ' + A.esc(plabel(state.to)) + ' counterparts</caption><thead><tr><th scope="col">From: ' + A.esc(plabel(state.from)) +
        '</th><th scope="col">To: ' + A.esc(plabel(state.to)) + '</th></tr></thead><tbody>' + slice.map(rowHtml).join('') + '</tbody></table></div>';
    } else {
      host.innerHTML = '<div class="lib-grid">' + slice.map(cardHtml).join('') + '</div>';
    }
    updateMore();
  }

  function appendChunk() {
    var host = $('results');
    var next = Math.min(state.shown + chunkSize(), current.length);
    var slice = current.slice(state.shown, next);
    var html = slice.map(state.translate ? rowHtml : cardHtml).join('');
    var target = host.querySelector(state.translate ? 'tbody' : '.lib-grid');
    if (target) target.insertAdjacentHTML('beforeend', html);
    state.shown = next;
    updateMore();
    updateCount();
  }

  function updateMore() {
    var more = $('more'), left = current.length - state.shown;
    more.hidden = left <= 0;
    more.textContent = 'Show more (' + left + ' remaining)';
  }

  function emptyHtml() {
    var q = state.q.trim();
    var enc = encodeURIComponent(q);
    var filters = !!(q || state.cat);
    var h = '<div class="empty-state"><h2>' + (q ? 'No libraries match &ldquo;' + A.esc(q) + '&rdquo;' : 'No libraries to show') + '</h2>' +
      '<p>' + (state.translate ? 'Only libraries with a ' + A.esc(plabel(state.from)) + ' entry are listed in translate mode. ' : '') +
      'Try a different spelling, a package id or a broader term.</p><div class="row">';
    if (filters) h += '<button type="button" class="btn btn-primary" data-clear>Clear filters</button>';
    h += '<a class="btn" href="' + A.esc(A.url('components/') + (q ? '?q=' + enc : '')) + '">Search Components</a>' +
      '<a class="btn" href="' + A.esc(A.url('equivalents/') + (q ? '?q=' + enc : '')) + '">Search Equivalents</a></div></div>';
    return h;
  }

  function updateChips(base) {
    var cats = categoryList(), counts = {};
    base.forEach(function (r) { counts[r.item.category] = (counts[r.item.category] || 0) + 1; });
    if (state.cat && !cats.some(function (c) { return c.id === state.cat; }) && sources().length === neededKeys(state.tab).length) state.cat = '';
    var html = '<button type="button" class="chip" data-cat="" aria-pressed="' + (state.cat === '') + '">All <span class="count">' + base.length + '</span></button>';
    cats.forEach(function (c) {
      var n = counts[c.id] || 0;
      if (!n && state.cat !== c.id) return;
      html += '<button type="button" class="chip" data-cat="' + A.esc(c.id) + '" aria-pressed="' + (state.cat === c.id) + '">' +
        A.esc(c.label) + ' <span class="count">' + n + '</span></button>';
    });
    $('cats').innerHTML = html;
  }

  function updateTabs() {
    var btns = document.querySelectorAll('#tabs .lib-seg-btn');
    Array.prototype.forEach.call(btns, function (b) {
      var t = b.getAttribute('data-tab');
      b.setAttribute('aria-pressed', String(t === state.tab));
      var keys = neededKeys(t), n = 0, ok = true;
      keys.forEach(function (k) { if (loaded[k]) n += loaded[k].records.length; else ok = false; });
      b.querySelector('.count').textContent = ok ? '(' + n + ')' : '';
    });
  }

  function updateCount() {
    var n = current.length, el = $('count');
    var txt = n + ' ' + (n === 1 ? 'library' : 'libraries');
    if (state.q.trim()) txt += ' matching “' + state.q.trim() + '”';
    if (state.translate) txt += ' with ' + plabel(state.from) + ' entries';
    if (n && state.shown < n) txt += ' (showing ' + state.shown + ')';
    el.textContent = txt;
  }

  function updateMeta() {
    var dates = Object.keys(loaded).map(function (k) { return loaded[k] && loaded[k].meta && loaded[k].meta.updated; }).filter(Boolean).sort();
    $('meta-line').textContent = dates.length ? 'Data last updated ' + dates[dates.length - 1] + '.' : '';
  }

  function updateTranslateUI() {
    $('tr-toggle').setAttribute('aria-pressed', String(state.translate));
    document.querySelector('.lib-translate').classList.toggle('on', state.translate);
    $('from').value = state.from; $('to').value = state.to;
  }

  function updateNotice() {
    var bad = neededKeys(state.tab).filter(function (k) { return failed[k]; });
    var host = $('notice');
    if (!bad.length) { host.innerHTML = ''; return; }
    var names = bad.map(function (k) { return SOURCES[k].label; }).join(' and ');
    host.innerHTML = '<div class="lib-notice" role="alert"><span>Could not load ' + A.esc(names) + ' data.</span>' +
      '<button type="button" class="btn" data-retry>Retry</button></div>';
  }

  function syncUrl() {
    A.params.set({
      q: state.q.trim() || null,
      tab: state.tab === 'all' ? null : state.tab,
      cat: state.cat || null,
      from: state.translate ? state.from : null,
      to: state.translate ? state.to : null
    });
  }

  function render() {
    var base = baseList();
    updateChips(base);
    current = state.cat ? base.filter(function (r) { return r.item.category === state.cat; }) : base;
    updateTabs(); updateTranslateUI(); updateNotice(); updateMeta();
    var need = neededKeys(state.tab);
    if (need.every(function (k) { return failed[k]; })) {
      $('results').setAttribute('aria-busy', 'false');
      $('results').innerHTML = '<div class="empty-state"><h2>Could not load the library data</h2><p>Check your connection and try again.</p>' +
        '<div class="row"><button type="button" class="btn btn-primary" data-retry>Retry</button></div></div>';
      $('more').hidden = true; $('count').textContent = '';
      return;
    }
    renderResults();
    updateCount();
    syncUrl();
  }

  /* ---------- actions ---------- */
  function setTab(tab) {
    state.tab = tab; state.cat = '';
    var token = ++loadToken;
    if (neededKeys(tab).every(function (k) { return loaded[k] || failed[k]; }) === false) {
      $('results').setAttribute('aria-busy', 'true');
      $('results').innerHTML = '<p class="muted">Loading libraries…</p>';
    }
    ensure(tab).then(function () { if (token === loadToken) { render(); prefetch(); } });
  }

  function prefetch() {
    ['ui', 'deps'].forEach(function (k) {
      if (!loaded[k] && !failed[k]) loadSource(k).then(function () { updateTabs(); updateMeta(); });
    });
  }

  function retry() {
    neededKeys(state.tab).forEach(function (k) { failed[k] = null; });
    $('results').innerHTML = '<p class="muted">Loading libraries…</p>';
    var token = ++loadToken;
    ensure(state.tab).then(function () { if (token === loadToken) render(); });
  }

  function clearFilters() {
    state.q = ''; state.cat = ''; $('q').value = '';
    render();
  }

  function setPair(from, to, changed) {
    if (from === to) { if (changed === 'from') to = state.from; else from = state.to; }
    if (from === to) to = ORDER.filter(function (k) { return k !== from; })[0];
    state.from = from; state.to = to;
  }

  function init() {
    var qs = A.params;
    var tab = qs.get('tab'); state.tab = TABS.indexOf(tab) !== -1 ? tab : 'all';
    state.q = qs.get('q'); state.cat = qs.get('cat');
    var f = qs.get('from'), t = qs.get('to');
    state.translate = !!(f || t);
    if (ORDER.indexOf(f) !== -1) state.from = f;
    if (ORDER.indexOf(t) !== -1) state.to = t;
    if (state.from === state.to) state.to = state.from === 'ios' ? 'android' : 'ios';
    $('q').value = state.q;

    var opts = ORDER.map(function (k) { return '<option value="' + A.esc(k) + '">' + A.esc(plabel(k)) + '</option>'; }).join('');
    $('from').innerHTML = opts; $('to').innerHTML = opts;
    updateTranslateUI(); updateTabs();

    $('q').addEventListener('input', A.debounce(function () { state.q = $('q').value; render(); }, 120));
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]'); if (!b) return;
      var t2 = b.getAttribute('data-tab'); if (t2 !== state.tab) setTab(t2);
    });
    $('tr-toggle').addEventListener('click', function () { state.translate = !state.translate; render(); });
    $('from').addEventListener('change', function () { setPair($('from').value, state.to, 'from'); state.translate = true; render(); });
    $('to').addEventListener('change', function () { setPair(state.from, $('to').value, 'to'); state.translate = true; render(); });
    $('swap').addEventListener('click', function () { var f2 = state.from; state.from = state.to; state.to = f2; state.translate = true; render(); });
    $('cats').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b) return;
      state.cat = b.getAttribute('data-cat'); render();
    });
    $('more').addEventListener('click', appendChunk);
    $('copy-link').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      copyText(location.href).then(function (ok) { flash(btn, ok ? 'Link copied' : 'Copy failed'); announce(ok ? 'Link copied' : 'Copy failed'); });
    });
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (c) {
        copyText(c.getAttribute('data-copy')).then(function (ok) { flash(c, ok ? 'Copied' : 'Failed'); announce(ok ? 'Install line copied' : 'Copy failed'); });
        return;
      }
      var tg = e.target.closest('[data-tag]');
      if (tg) { state.q = tg.getAttribute('data-tag'); $('q').value = state.q; render(); window.scrollTo({ top: 0 }); return; }
      if (e.target.closest('[data-clear]')) { clearFilters(); return; }
      if (e.target.closest('[data-retry]')) retry();
    });

    var token = ++loadToken;
    ensure(state.tab).then(function () { if (token === loadToken) { render(); prefetch(); } });
  }

  function announce(msg) {
    var el = $('announce'); if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = msg; }, 30);
  }

  init();
})();
