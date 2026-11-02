/* components.js — unified Components explorer.
 * Data (not duplicated here): compose/<category>.json  = "Modern" era (Jetpack Compose / SwiftUI)
 *                             data/components-classic.json = "Classic" era (Android Views / UIKit)
 * Uses window.AIS from assets/js/shell.js (fetchJSON, esc, highlight, tokens, score, params).
 */
(function () {
  'use strict';

  /* Same list as CATEGORIES at the top of compose/compose.js (file names under compose/). */
  var CATEGORIES = [
    'layouts', 'inputs', 'buttons', 'selectors', 'navigation',
    'display', 'accessibility', 'state', 'storage', 'networking',
    'permissions', 'sensors', 'notifications', 'security', 'devtools',
    'utilities', 'platform', 'animations', 'dragdrop', 'text',
    'gestures', 'overlays'
  ];
  var CLASSIC_PATH = 'data/components-classic.json';
  var CAT_LABEL_OVERRIDE = { dragdrop: 'Drag & drop', devtools: 'Dev tools' };
  var CHUNK = 60;
  var LS_VIEW = 'ais-comp-view';
  var LS_PF = 'ais-comp-pf';

  /* Platform keys valid per era. In "all", android/ios are "sides": Views/UIKit for classic rows,
     Compose/SwiftUI for modern rows. */
  var REST = ['flutter', 'react_native', 'xamarin', 'ionic'];
  var FAMILY = {
    modern: ['compose', 'swiftui'].concat(REST),
    classic: ['android', 'ios'].concat(REST),
    all: ['android', 'ios'].concat(REST)
  };
  var DEFAULT_PF = {
    modern: ['compose', 'swiftui', 'flutter', 'react_native'],
    classic: ['android', 'ios', 'flutter', 'react_native'],
    all: ['android', 'ios', 'flutter', 'react_native']
  };
  var DEFAULT_FT = {
    modern: ['compose', 'swiftui'],
    classic: ['android', 'ios'],
    all: ['android', 'ios']
  };
  var LABELS = {
    android: 'Android Views', ios: 'iOS UIKit', compose: 'Jetpack Compose', swiftui: 'SwiftUI',
    react_native: 'React Native', flutter: 'Flutter', xamarin: '.NET MAUI', ionic: 'Ionic'
  };
  var LABELS_ALL = { android: 'Android', ios: 'iOS' };
  var FW_TAG = { android: 'Views', ios: 'UIKit', compose: 'Compose', swiftui: 'SwiftUI' };
  var ERA_NAME = { modern: 'Modern', classic: 'Classic' };

  var $ = function (id) { return document.getElementById(id); };
  var esc = AIS.esc;

  var el = {
    q: $('cx-q'), era: $('cx-era'), mode: $('cx-mode'), view: $('cx-view'), cols: $('cx-cols'),
    colsWrap: $('cx-cols-wrap'), ftWrap: $('cx-ft-wrap'), from: $('cx-from'), to: $('cx-to'), swap: $('cx-swap'),
    cats: $('cx-cats'), catsToggle: $('cx-cats-toggle'), copy: $('cx-copy'), clear: $('cx-clear'),
    count: $('cx-count'), live: $('cx-live'), warn: $('cx-warn'), suggest: $('cx-suggest'),
    results: $('cx-results'), more: $('cx-more'), lede: $('cx-lede')
  };

  /* ---------- state ---------- */
  var state = { q: '', era: 'all', cat: '', pf: [], view: 'table', mode: 'browse', from: '', to: '', limit: CHUNK };
  var records = [];      // normalized rows; records[i].uid === i
  var catList = [];      // ordered [{id,label,era,desc}]
  var loadedFiles = {};  // path -> parsed JSON
  var failed = [];       // paths that failed
  var expanded = {};     // uid -> true
  var results = [];      // current filtered+ranked records
  var ready = false;

  /* ---------- small helpers ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function isDesktop() { return window.matchMedia && window.matchMedia('(min-width: 820px)').matches; }
  function autoView() { return isDesktop() ? 'table' : 'cards'; }
  function catLabelFor(id) { return CAT_LABEL_OVERRIDE[id] || id.charAt(0).toUpperCase() + id.slice(1); }

  var NONE_RE = /^(|n\/a|not applicable|none|-|—)$/i;
  function nm(v) {
    if (v == null) return null;
    var s = String(v).trim();
    return NONE_RE.test(s) ? null : s;
  }
  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    try {
      var x = new URL(u);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null;
    } catch (e) { return null; }
  }

  function mapKey(era, k) {
    if (era === 'modern') return k === 'android' ? 'compose' : k === 'ios' ? 'swiftui' : k;
    return k === 'compose' ? 'android' : k === 'swiftui' ? 'ios' : k;
  }
  /* The real key to read from `rec` for a (possibly side-mapped) column key. */
  function resolve(rec, pk) {
    if (rec.era === 'modern') return pk === 'android' ? 'compose' : pk === 'ios' ? 'swiftui' : pk;
    return pk === 'compose' ? 'android' : pk === 'swiftui' ? 'ios' : pk;
  }
  function pfLabel(era, pk) { return (era === 'all' && LABELS_ALL[pk]) || LABELS[pk] || pk; }
  function normPf(list, era) {
    var set = {};
    list.forEach(function (k) { set[mapKey(era, k)] = true; });
    return FAMILY[era].filter(function (k) { return set[k]; });
  }
  function sameList(a, b) { return a.length === b.length && a.every(function (v, i) { return v === b[i]; }); }

  /* ---------- persisted column choice (per era) ---------- */
  function savedPf(era) {
    var raw = lsGet(LS_PF);
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      var l = o && Array.isArray(o[era]) ? normPf(o[era], era) : [];
      return l.length ? l : null;
    } catch (e) { return null; }
  }
  function savePf(era, list) {
    var o = {};
    try { o = JSON.parse(lsGet(LS_PF) || '{}') || {}; } catch (e) { o = {}; }
    o[era] = list;
    lsSet(LS_PF, JSON.stringify(o));
  }
  function defaultPf(era) { return DEFAULT_PF[era].slice(); }

  /* ---------- data loading ---------- */
  function allPaths() {
    return CATEGORIES.map(function (c) { return 'compose/' + c + '.json'; }).concat([CLASSIC_PATH]);
  }
  function validate(path, j) {
    if (path === CLASSIC_PATH) { if (!j || !Array.isArray(j.groups)) throw new Error('bad shape'); }
    else if (!j || !Array.isArray(j.items)) throw new Error('bad shape');
  }
  function load() {
    var todo = allPaths().filter(function (p) { return !loadedFiles[p]; });
    return Promise.all(todo.map(function (p) {
      return AIS.fetchJSON(p).then(function (j) { validate(p, j); loadedFiles[p] = j; return null; },
                                   function () { return p; });
    })).then(function (r) {
      failed = allPaths().filter(function (p) { return !loadedFiles[p]; });
      buildRecords();
    });
  }

  function makeRec(era, cat, item, family) {
    var names = {}, links = {};
    family.forEach(function (k) {
      var n = nm(item[k]);
      names[k] = n;
      links[k] = n ? safeUrl(item.links && item.links[k]) : null;
    });
    var lower = [];
    Object.keys(names).forEach(function (k) { if (names[k]) lower.push(names[k].toLowerCase()); });
    var rec = {
      uid: records.length, era: era, cat: cat.id, catLabel: cat.label, component: String(item.component),
      names: names, links: links, lower: lower
    };
    rec.hay = [rec.component, cat.label].concat(Object.keys(names).map(function (k) { return names[k] || ''; })).join(' ');
    rec.componentLower = rec.component.toLowerCase();
    lower.push(rec.componentLower);
    return rec;
  }

  function buildRecords() {
    records = []; catList = [];
    CATEGORIES.forEach(function (c) {
      var j = loadedFiles['compose/' + c + '.json'];
      if (!j) return;
      var cat = { id: c, label: catLabelFor(c), era: 'modern', desc: (j.metadata && j.metadata.description) || '' };
      var n = 0;
      j.items.forEach(function (item) {
        if (!item || typeof item.component !== 'string' || !item.component.trim()) return;
        records.push(makeRec('modern', cat, item, FAMILY.modern)); n++;
      });
      if (n) catList.push(cat);
    });
    var cj = loadedFiles[CLASSIC_PATH];
    if (cj) {
      cj.groups.forEach(function (g) {
        if (!g || !Array.isArray(g.items)) return;
        var cat = { id: 'classic-' + g.id, label: String(g.label || g.id), era: 'classic', desc: '' };
        var n = 0;
        g.items.forEach(function (item) {
          if (!item || typeof item.component !== 'string' || !item.component.trim()) return;
          records.push(makeRec('classic', cat, item, FAMILY.classic)); n++;
        });
        if (n) catList.push(cat);
      });
    }
  }

  /* ---------- filtering + ranking ---------- */
  var base = [], eraCounts = { all: 0, modern: 0, classic: 0 }, catCounts = {};

  function compute() {
    var q = state.q.trim(), ql = q.toLowerCase(), tr = state.mode === 'translate';
    base = [];
    records.forEach(function (rec) {
      var title = rec.component;
      if (tr) {
        var fk = resolve(rec, state.from), tk = resolve(rec, state.to);
        if (!(fk in rec.names) || !(tk in rec.names) || !rec.names[fk]) return;
        title = rec.names[fk] + ' ' + rec.component;
      }
      var s = AIS.score(q, { title: title, text: rec.hay });
      if (!s) return;
      if (q && rec.lower.indexOf(ql) !== -1) s += 5;
      base.push({ rec: rec, s: s });
    });
    eraCounts = { all: base.length, modern: 0, classic: 0 };
    catCounts = {};
    var inEra = [];
    base.forEach(function (b) {
      eraCounts[b.rec.era]++;
      if (state.era === 'all' || b.rec.era === state.era) {
        inEra.push(b);
        catCounts[b.rec.cat] = (catCounts[b.rec.cat] || 0) + 1;
      }
    });
    var picked = state.cat ? inEra.filter(function (b) { return b.rec.cat === state.cat; }) : inEra;
    if (q) picked.sort(function (a, b) { return b.s - a.s || a.rec.uid - b.rec.uid; });
    results = picked.map(function (b) { return b.rec; });
  }

  /* ---------- URL ---------- */
  var urlTimer;
  function syncURL() {
    var def = defaultPf(state.era);
    var tr = state.mode === 'translate';
    AIS.params.set({
      q: state.q.trim(),
      era: state.era === 'all' ? null : state.era,
      cat: state.cat,
      pf: !tr && !sameList(state.pf, def) ? state.pf.join(',') : null,
      view: state.view === autoView() ? null : state.view,
      from: tr ? state.from : null,
      to: tr ? state.to : null
    });
  }
  function syncURLSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(syncURL, 250); }

  /* ---------- cell / row rendering ---------- */
  function cell(rec, pk, q, withTag) {
    var k = resolve(rec, pk);
    if (!(k in rec.names)) return '<span class="cx-na" title="Not part of this set">&middot;</span>';
    var name = rec.names[k];
    if (!name) return '<span class="cx-none" title="No direct equivalent">&mdash;<span class="sr-only">No direct equivalent</span></span>';
    var txt = AIS.highlight(name, q);
    var url = rec.links[k];
    var out = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>' : '<span>' + txt + '</span>';
    if (withTag && FW_TAG[k] && (state.era === 'all') && (pk === 'android' || pk === 'ios')) {
      out += ' <span class="cx-fw">' + esc(FW_TAG[k]) + '</span>';
    }
    return out;
  }

  function nameBtn(rec, q) {
    var open = !!expanded[rec.uid];
    return '<button type="button" class="cx-name" data-toggle="' + rec.uid + '" aria-expanded="' + open +
      '"' + (open ? ' aria-controls="cx-d-' + rec.uid + '"' : '') + '><span class="cx-chev" aria-hidden="true"></span><span>' +
      AIS.highlight(rec.component, q) + '</span></button>';
  }
  function subLine(rec) {
    return '<div class="cx-sub">' + (state.era === 'all' ? esc(ERA_NAME[rec.era]) + ' &middot; ' : '') + esc(rec.catLabel) + '</div>';
  }
  function hiddenHint(rec, q, shown) {
    var toks = AIS.tokens(q);
    if (!toks.length) return '';
    if (toks.every(function (t) { return rec.componentLower.indexOf(t) !== -1; })) return '';
    var shownReal = {};
    shown.forEach(function (pk) { shownReal[resolve(rec, pk)] = true; });
    var hits = [];
    FAMILY[rec.era].forEach(function (k) {
      var n = rec.names[k];
      if (shownReal[k] || !n) return;
      var nl = n.toLowerCase();
      if (toks.some(function (t) { return nl.indexOf(t) !== -1; })) hits.push('<b>' + esc(LABELS[k]) + '</b>: ' + AIS.highlight(n, q));
    });
    return hits.length ? '<div class="cx-hint">Matches ' + hits.slice(0, 2).join(' &middot; ') + '</div>' : '';
  }

  function detailInner(rec) {
    var items = FAMILY[rec.era].map(function (k) {
      var n = rec.names[k], u = rec.links[k], body;
      if (!n) body = '<span class="cx-none" title="No direct equivalent">&mdash;<span class="sr-only">No direct equivalent</span></span>';
      else if (u) body = '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(n) + '</a>';
      else body = '<span>' + esc(n) + '</span>';
      return '<div class="cx-d-item"><span class="pf pf-' + k + '">' + esc(LABELS[k]) + '</span>' + body + '</div>';
    }).join('');
    var enc = encodeURIComponent(rec.component);
    return '<div class="cx-detail-grid">' + items + '</div>' +
      '<p class="cx-detail-more small muted">Look further: <a href="' + esc(AIS.url('libraries/?q=' + enc)) + '">Libraries for &ldquo;' + esc(rec.component) +
      '&rdquo;</a> &middot; <a href="' + esc(AIS.url('equivalents/?q=' + enc)) + '">Equivalents for &ldquo;' + esc(rec.component) + '&rdquo;</a></p>';
  }
  function detailRow(rec, colspan) {
    return '<tr class="cx-detail" id="cx-d-' + rec.uid + '"><td colspan="' + colspan + '">' + detailInner(rec) + '</td></tr>';
  }
  function detailCard(rec) {
    return '<div class="cx-detail" id="cx-d-' + rec.uid + '">' + detailInner(rec) + '</div>';
  }

  function renderBrowse(list, q) {
    var cols = state.pf;
    if (state.view === 'table') {
      var head = '<th scope="col">Component</th>' + cols.map(function (pk) {
        return '<th scope="col"><span class="pf pf-' + pk + '">' + esc(pfLabel(state.era, pk)) + '</span></th>';
      }).join('');
      var rows = list.map(function (rec) {
        var open = !!expanded[rec.uid];
        return '<tr data-uid="' + rec.uid + '"><th scope="row">' + nameBtn(rec, q) + subLine(rec) + hiddenHint(rec, q, cols) + '</th>' +
          cols.map(function (pk) { return '<td>' + cell(rec, pk, q, true) + '</td>'; }).join('') + '</tr>' +
          (open ? detailRow(rec, cols.length + 1) : '');
      }).join('');
      return '<div class="table-wrap"><table class="data cx-table"><caption class="sr-only">Component equivalents by platform</caption><thead><tr>' +
        head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return '<div class="grid cx-grid">' + list.map(function (rec) {
      var dl = cols.map(function (pk) {
        return '<div class="cx-dl-row"><dt><span class="pf pf-' + pk + '">' + esc(pfLabel(state.era, pk)) + '</span></dt><dd>' + cell(rec, pk, q, true) + '</dd></div>';
      }).join('');
      return '<article class="card cx-card" data-uid="' + rec.uid + '"><div class="cx-card-head">' + nameBtn(rec, q) + '</div>' +
        subLine(rec) + hiddenHint(rec, q, cols) + '<dl class="cx-dl">' + dl + '</dl>' + (expanded[rec.uid] ? detailCard(rec) : '') + '</article>';
    }).join('') + '</div>';
  }

  function renderTranslate(list, q) {
    var fl = pfLabel(state.era, state.from), tl = pfLabel(state.era, state.to);
    if (state.view === 'table') {
      var rows = list.map(function (rec) {
        var open = !!expanded[rec.uid];
        return '<tr data-uid="' + rec.uid + '"><th scope="row">' + nameBtn(rec, q) + subLine(rec) + '</th>' +
          '<td class="cx-big">' + cell(rec, state.from, q, true) + '</td><td class="cx-big">' + cell(rec, state.to, '', true) + '</td></tr>' +
          (open ? detailRow(rec, 3) : '');
      }).join('');
      return '<div class="table-wrap"><table class="data cx-table cx-table-tr"><caption class="sr-only">' + esc(fl) + ' to ' + esc(tl) + '</caption><thead><tr>' +
        '<th scope="col">Component</th><th scope="col"><span class="pf pf-' + state.from + '">' + esc(fl) + '</span></th>' +
        '<th scope="col"><span class="pf pf-' + state.to + '">' + esc(tl) + '</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return '<div class="grid cx-grid">' + list.map(function (rec) {
      return '<article class="card cx-card" data-uid="' + rec.uid + '"><div class="cx-card-head">' + nameBtn(rec, q) + '</div>' + subLine(rec) +
        '<div class="cx-tr"><div><span class="pf pf-' + state.from + '">' + esc(fl) + '</span><div class="cx-big">' + cell(rec, state.from, q, true) + '</div></div>' +
        '<span class="cx-arrow" aria-hidden="true">&rarr;</span>' +
        '<div><span class="pf pf-' + state.to + '">' + esc(tl) + '</span><div class="cx-big">' + cell(rec, state.to, '', true) + '</div></div></div>' +
        (expanded[rec.uid] ? detailCard(rec) : '') + '</article>';
    }).join('') + '</div>';
  }

  function skeleton() {
    var rows = '';
    for (var i = 0; i < 8; i++) rows += '<div class="cx-skel-row"><span class="cx-skel" style="width:' + (28 + (i * 7) % 20) + '%"></span><span class="cx-skel"></span><span class="cx-skel"></span><span class="cx-skel"></span></div>';
    return '<div class="cx-skels" aria-hidden="true">' + rows + '</div><p class="sr-only">Loading components</p>';
  }

  /* ---------- main render ---------- */
  function render() {
    var q = state.q.trim(), n = results.length, tr = state.mode === 'translate';
    var enc = encodeURIComponent(q);

    // count
    var msg = n + ' component' + (n === 1 ? '' : 's');
    if (q) msg += ' for “' + q + '”';
    if (tr) msg += ' with an entry for ' + pfLabel(state.era, state.from);
    if (n > state.limit) msg += ' · showing ' + state.limit;
    el.count.textContent = msg;

    // suggestions when few matches
    if (q && n < 3) {
      el.suggest.hidden = false;
      el.suggest.className = 'cx-suggest';
      el.suggest.innerHTML = 'Few matches for “' + esc(q) + '”. It may be a library or a concept rather than a UI component: try ' +
        '<a href="' + esc(AIS.url('libraries/?q=' + enc)) + '">Libraries</a> or <a href="' + esc(AIS.url('equivalents/?q=' + enc)) + '">Equivalents</a>.';
    } else { el.suggest.hidden = true; el.suggest.innerHTML = ''; }

    el.results.setAttribute('aria-busy', 'false');
    if (!n) {
      var why = tr
        ? 'No entries list both ' + esc(pfLabel(state.era, state.from)) + ' and ' + esc(pfLabel(state.era, state.to)) +
          (q || state.cat ? ' for these filters' : '') + '. Views/UIKit entries and Compose/SwiftUI entries are separate sets.'
        : 'No components match these filters.';
      el.results.innerHTML = '<div class="empty-state"><p>' + why + '</p>' +
        (hasFilters() ? '<button type="button" class="btn" data-action="clear">Clear search and filters</button>' : '') + '</div>';
      el.more.innerHTML = '';
      return;
    }
    var list = results.slice(0, state.limit);
    el.results.innerHTML = tr ? renderTranslate(list, q) : renderBrowse(list, q);
    el.more.innerHTML = n > state.limit
      ? '<button type="button" class="btn" data-action="more">Show more (' + Math.min(CHUNK, n - state.limit) + ' of ' + (n - state.limit) + ' remaining)</button>'
      : '';
  }

  function hasFilters() { return !!(state.q.trim() || state.cat || state.era !== 'all'); }

  /* ---------- controls ---------- */
  function chip(label, pressed, attrs, extra) {
    return '<button type="button" class="chip" aria-pressed="' + pressed + '" ' + attrs + '>' + label + (extra || '') + '</button>';
  }

  function paintEra() {
    var defs = [['all', 'All'], ['modern', 'Modern: Compose + SwiftUI'], ['classic', 'Classic: Views + UIKit']];
    el.era.innerHTML = defs.map(function (d) {
      return chip(esc(d[1]), state.era === d[0], 'data-era="' + d[0] + '"', ' <span class="count">' + (ready ? eraCounts[d[0]] : '') + '</span>');
    }).join('');
  }
  function paintMode() {
    el.mode.innerHTML =
      chip('Browse', state.mode === 'browse', 'data-mode="browse"') +
      chip('From → To', state.mode === 'translate', 'data-mode="translate"');
  }
  function paintView() {
    el.view.innerHTML = chip('Table', state.view === 'table', 'data-view="table"') + chip('Cards', state.view === 'cards', 'data-view="cards"');
  }
  function paintCols() {
    el.cols.innerHTML = FAMILY[state.era].map(function (pk) {
      return chip(esc(pfLabel(state.era, pk)), state.pf.indexOf(pk) !== -1, 'data-pf="' + pk + '"');
    }).join('');
  }
  function paintFromTo() {
    var opts = FAMILY[state.era].map(function (pk) { return '<option value="' + pk + '">' + esc(pfLabel(state.era, pk)) + '</option>'; }).join('');
    el.from.innerHTML = opts; el.to.innerHTML = opts;
    el.from.value = state.from; el.to.value = state.to;
  }
  function paintCats() {
    var cats = catList.filter(function (c) { return state.era === 'all' || c.era === state.era; });
    el.cats.innerHTML = cats.map(function (c) {
      var label = (state.era === 'all' && c.era === 'classic' ? 'Classic: ' : '') + c.label;
      return '<button type="button" class="chip" data-cat="' + esc(c.id) + '" aria-pressed="false"' + (c.desc ? ' title="' + esc(c.desc) + '"' : '') +
        '>' + esc(label) + ' <span class="count"></span></button>';
    }).join('');
    el.catsToggle.hidden = cats.length < 8;
  }
  function paintCounts() {
    var chips = el.cats.querySelectorAll('[data-cat]');
    for (var i = 0; i < chips.length; i++) {
      var id = chips[i].getAttribute('data-cat'), c = catCounts[id] || 0;
      chips[i].setAttribute('aria-pressed', state.cat === id ? 'true' : 'false');
      chips[i].classList.toggle('cx-zero', c === 0 && state.cat !== id);
      chips[i].querySelector('.count').textContent = c;
    }
    ['all', 'modern', 'classic'].forEach(function (k) {
      var b = el.era.querySelector('[data-era="' + k + '"] .count');
      if (b) b.textContent = eraCounts[k];
    });
    el.cats.classList.toggle('cx-filtered', !!state.q.trim());
    el.clear.hidden = !hasFilters();
  }
  function paintModeVisibility() {
    var tr = state.mode === 'translate';
    el.colsWrap.hidden = tr; el.ftWrap.hidden = !tr;
  }
  function paintAll() {
    paintEra(); paintMode(); paintView(); paintCols(); paintFromTo(); paintCats(); paintModeVisibility();
  }

  /* Apply a new era: re-derive era-dependent selections. */
  function setEra(era) {
    if (era === state.era) return;
    var prevEra = state.era;
    state.era = era;
    state.pf = savedPf(era) || defaultPf(era);
    state.from = mapKey(era, state.from); state.to = mapKey(era, state.to);
    if (FAMILY[era].indexOf(state.from) === -1) state.from = DEFAULT_FT[era][0];
    if (FAMILY[era].indexOf(state.to) === -1 || state.to === state.from) state.to = DEFAULT_FT[era][1];
    var cur = catList.filter(function (c) { return c.id === state.cat; })[0];
    if (cur && era !== 'all' && cur.era !== era) state.cat = '';
    state.limit = CHUNK;
    void prevEra;
    paintCols(); paintFromTo(); paintCats();
  }

  function refresh(opts) {
    opts = opts || {};
    compute();
    if (opts.resetLimit) state.limit = CHUNK;
    paintCounts();
    render();
    if (opts.urlNow) syncURL(); else syncURLSoon();
  }

  /* ---------- lede + warnings ---------- */
  function paintLede() {
    var m = 0, c = 0;
    records.forEach(function (r) { if (r.era === 'modern') m++; else c++; });
    if (!records.length) return;
    el.lede.textContent = records.length + ' UI components in ' + catList.length + ' categories (' + m +
      ' Modern: Jetpack Compose and SwiftUI; ' + c + ' Classic: Android Views and UIKit), each mapped to Flutter, React Native, .NET MAUI and Ionic with links to the official docs. Search by any platform’s name.' +
      (failed.length ? ' Some data failed to load, so this list is partial.' : '');
  }
  function paintWarn() {
    if (!failed.length) { el.warn.hidden = true; el.warn.innerHTML = ''; return; }
    var names = failed.map(function (p) { return p.replace(/^.*\//, '').replace(/\.json$/, ''); });
    el.warn.hidden = false;
    el.warn.innerHTML = '<span>Could not load ' + failed.length + ' of ' + allPaths().length + ' data files (' + esc(names.join(', ')) +
      '). Showing what loaded.</span> <button type="button" class="btn" data-action="retry">Retry</button>';
  }

  /* ---------- events ---------- */
  function onPfToggle(pk) {
    var i = state.pf.indexOf(pk);
    if (i === -1) state.pf.push(pk);
    else if (state.pf.length > 1) state.pf.splice(i, 1);
    else return;
    state.pf = FAMILY[state.era].filter(function (k) { return state.pf.indexOf(k) !== -1; });
    savePf(state.era, state.pf);
    var chips = el.cols.querySelectorAll('[data-pf]');
    for (var j = 0; j < chips.length; j++) chips[j].setAttribute('aria-pressed', state.pf.indexOf(chips[j].getAttribute('data-pf')) !== -1 ? 'true' : 'false');
    refresh({});
  }

  function clearAll() {
    state.q = ''; el.q.value = '';
    state.cat = '';
    setEra('all');
    state.limit = CHUNK;
    paintEra();
    refresh({ urlNow: true });
  }

  function toggleDetail(uid, btn) {
    var rec = records[uid];
    if (!rec) return;
    var open = !!expanded[uid];
    var host = btn.closest('tr') || btn.closest('.cx-card');
    if (open) {
      delete expanded[uid];
      var d = $('cx-d-' + uid); if (d) d.remove();
      btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls');
    } else {
      expanded[uid] = true;
      if (host.tagName === 'TR') host.insertAdjacentHTML('afterend', detailRow(rec, host.cells.length));
      else host.insertAdjacentHTML('beforeend', detailCard(rec));
      btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', 'cx-d-' + uid);
    }
  }

  function announce(msg) {
    el.live.textContent = '';
    setTimeout(function () { el.live.textContent = msg; }, 30);
  }

  function copyLink() {
    clearTimeout(urlTimer); syncURL();
    var href = location.href;
    function done(ok) {
      var old = el.copy.textContent;
      el.copy.textContent = ok ? 'Link copied' : 'Copy failed';
      announce(ok ? 'Link copied to clipboard' : 'Could not copy the link');
      setTimeout(function () { el.copy.textContent = 'Copy link'; void old; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(href).then(function () { done(true); }, function () { fallbackCopy(href, done); });
    } else fallbackCopy(href, done);
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove(); done(ok);
    } catch (e) { done(false); }
  }

  function wire() {
    el.q.addEventListener('input', function () {
      state.q = el.q.value; state.limit = CHUNK;
      if (ready) refresh({});
    });
    el.q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.q.value) { el.q.value = ''; state.q = ''; if (ready) refresh({}); }
    });

    el.era.addEventListener('click', function (e) {
      var b = e.target.closest('[data-era]'); if (!b || !ready) return;
      setEra(b.getAttribute('data-era'));
      var all = el.era.querySelectorAll('[data-era]');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', all[i] === b ? 'true' : 'false');
      refresh({ resetLimit: true, urlNow: true });
    });
    el.mode.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]'); if (!b || !ready) return;
      state.mode = b.getAttribute('data-mode');
      if (state.mode === 'translate' && (!state.from || !state.to)) {
        state.from = DEFAULT_FT[state.era][0]; state.to = DEFAULT_FT[state.era][1];
      }
      paintMode(); paintFromTo(); paintModeVisibility();
      refresh({ resetLimit: true, urlNow: true });
    });
    el.view.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]'); if (!b) return;
      state.view = b.getAttribute('data-view');
      lsSet(LS_VIEW, state.view);
      paintView();
      if (ready) { render(); syncURL(); }
    });
    el.cols.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pf]'); if (b && ready) onPfToggle(b.getAttribute('data-pf'));
    });
    el.cats.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b || !ready) return;
      var id = b.getAttribute('data-cat');
      state.cat = state.cat === id ? '' : id;
      refresh({ resetLimit: true, urlNow: true });
    });
    el.catsToggle.addEventListener('click', function () {
      var collapsed = el.cats.classList.toggle('collapsed');
      el.catsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      el.catsToggle.textContent = collapsed ? 'Show all categories' : 'Show fewer categories';
    });

    function ftChange(which) {
      if (!ready) return;
      state[which] = (which === 'from' ? el.from : el.to).value;
      if (state.from === state.to) {
        var other = FAMILY[state.era].filter(function (k) { return k !== state[which]; })[0];
        if (which === 'from') state.to = other; else state.from = other;
        el.from.value = state.from; el.to.value = state.to;
      }
      refresh({ resetLimit: true, urlNow: true });
    }
    el.from.addEventListener('change', function () { ftChange('from'); });
    el.to.addEventListener('change', function () { ftChange('to'); });
    el.swap.addEventListener('click', function () {
      if (!ready) return;
      var t = state.from; state.from = state.to; state.to = t;
      el.from.value = state.from; el.to.value = state.to;
      refresh({ urlNow: true });
    });

    el.copy.addEventListener('click', copyLink);
    el.clear.addEventListener('click', function () { if (ready) clearAll(); });

    function delegated(e) {
      var t = e.target.closest('[data-toggle]');
      if (t) { toggleDetail(+t.getAttribute('data-toggle'), t); return; }
      var a = e.target.closest('[data-action]');
      if (!a) return;
      var act = a.getAttribute('data-action');
      if (act === 'clear') clearAll();
      else if (act === 'more') {
        var before = state.limit;
        state.limit += CHUNK; render();
        announce('Showing ' + Math.min(state.limit, results.length) + ' of ' + results.length);
        var rows = el.results.querySelectorAll('[data-uid]');
        if (rows[before]) { var f = rows[before].querySelector('.cx-name'); if (f) f.focus({ preventScroll: false }); }
      } else if (act === 'retry') retry();
    }
    el.results.addEventListener('click', delegated);
    el.more.addEventListener('click', delegated);
    el.warn.addEventListener('click', delegated);
  }

  /* ---------- boot ---------- */
  function applyURL() {
    var p = AIS.params;
    var era = p.get('era');
    state.era = (era === 'modern' || era === 'classic') ? era : 'all';
    state.q = p.get('q');
    el.q.value = state.q;
    state.cat = p.get('cat');
    var pf = p.get('pf');
    var fromUrl = pf ? normPf(pf.split(','), state.era) : [];
    state.pf = fromUrl.length ? fromUrl : (savedPf(state.era) || defaultPf(state.era));
    var v = p.get('view');
    state.view = (v === 'table' || v === 'cards') ? v : (lsGet(LS_VIEW) === 'table' || lsGet(LS_VIEW) === 'cards' ? lsGet(LS_VIEW) : autoView());
    var f = mapKey(state.era, p.get('from')), t = mapKey(state.era, p.get('to'));
    if (FAMILY[state.era].indexOf(f) !== -1 && FAMILY[state.era].indexOf(t) !== -1 && f !== t) {
      state.mode = 'translate'; state.from = f; state.to = t;
    } else {
      state.mode = 'browse';
      state.from = DEFAULT_FT[state.era][0]; state.to = DEFAULT_FT[state.era][1];
    }
  }

  function afterLoad() {
    // drop an unknown / era-mismatched cat from the URL
    var cur = catList.filter(function (c) { return c.id === state.cat; })[0];
    if (!cur || (state.era !== 'all' && cur.era !== state.era)) state.cat = '';
    paintLede(); paintWarn();
    if (!records.length) {
      ready = false;
      el.count.textContent = '';
      el.results.setAttribute('aria-busy', 'false');
      el.results.innerHTML = '<div class="empty-state"><p>Could not load the component data.</p><button type="button" class="btn btn-primary" data-action="retry">Retry</button></div>';
      return;
    }
    ready = true;
    paintAll();
    refresh({ urlNow: true });
  }

  function retry() {
    el.results.setAttribute('aria-busy', 'true');
    el.results.innerHTML = skeleton();
    load().then(afterLoad);
  }

  function init() {
    applyURL();
    wire();
    paintEra(); paintMode(); paintView(); paintCols(); paintFromTo(); paintModeVisibility();
    el.results.innerHTML = skeleton();
    load().then(afterLoad);
  }

  init();
})();
