/* Equivalents page — "Rosetta stone" between Android, iOS, Flutter and React Native.
 * Data: data/equivalents.json (see schema in project briefs). Depends on window.AIS (assets/js/shell.js). */
(function () {
  'use strict';

  var AIS = window.AIS;
  var esc = AIS.esc;

  var PF = ['android', 'ios', 'flutter', 'react_native'];
  var PF_LABEL = { android: 'Android', ios: 'iOS', flutter: 'Flutter', react_native: 'React Native' };
  var KINDS = ['concept', 'tooling'];
  var DEF_FROM = 'android', DEF_TO = 'ios';
  var CHUNK = 50;
  var DATA_PATH = 'data/equivalents.json';

  function $(id) { return document.getElementById(id); }
  var el = {
    q: $('eq-q'), from: $('eq-from'), to: $('eq-to'), swap: $('eq-swap'), kind: $('eq-kind'), tag: $('eq-tag'),
    sort: $('eq-sort'), cats: $('eq-cats'), az: $('eq-az'), count: $('eq-count'), reset: $('eq-reset'),
    copy: $('eq-copy'), hidden: $('eq-hidden'), loading: $('eq-loading'), error: $('eq-error'),
    errorMsg: $('eq-error-msg'), retry: $('eq-retry'), empty: $('eq-empty'), list: $('eq-list'),
    thead: $('eq-thead'), body: $('eq-body'), moreWrap: $('eq-more-wrap'), more: $('eq-more'), intro: $('eq-intro')
  };

  var state = { q: '', from: DEF_FROM, to: DEF_TO, kind: '', cat: '', tag: '', sort: 'cat', showMissing: false, shown: CHUNK };
  var data = null;       // { items, cats, catById, tags }
  var view = [];         // filtered + sorted items currently listed
  var missingHidden = 0; // items hidden only because they lack a "from" entry

  /* ---------------- helpers ---------------- */
  function safeUrl(u) {
    if (typeof u !== 'string' || !u) return '';
    try {
      var x = new URL(u);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '';
    } catch (e) { return ''; }
  }
  function isNoDirect(name) { return /^no direct equivalent/i.test(name || ''); }
  function closestOf(name) { return String(name).replace(/^no direct equivalent\s*[—–:\-]*\s*/i, '').trim(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }

  /* ---------------- data ---------------- */
  function normEntry(e) {
    if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !e.name.trim()) return null;
    return { name: e.name.trim(), url: safeUrl(e.url) };
  }

  function normalize(raw) {
    var items = [], seen = {};
    (Array.isArray(raw && raw.items) ? raw.items : []).forEach(function (r) {
      if (!r || typeof r.id !== 'string' || !r.id || seen[r.id] || typeof r.title !== 'string') return;
      seen[r.id] = 1;
      var it = {
        id: r.id,
        kind: r.kind === 'tooling' ? 'tooling' : 'concept',
        category: typeof r.category === 'string' ? r.category : '',
        title: r.title,
        notes: typeof r.notes === 'string' ? r.notes : '',
        tags: (Array.isArray(r.tags) ? r.tags : []).filter(function (t) { return typeof t === 'string' && t; }).map(lc),
        p: {}, lcName: {}, order: items.length, score: 1
      };
      PF.forEach(function (pf) { it.p[pf] = normEntry(r[pf]); it.lcName[pf] = it.p[pf] ? lc(it.p[pf].name) : ''; });
      items.push(it);
    });

    var cats = [], catById = {};
    (Array.isArray(raw && raw.categories) ? raw.categories : []).forEach(function (c) {
      if (!c || typeof c.id !== 'string' || catById[c.id]) return;
      catById[c.id] = { id: c.id, label: c.label || c.id, kind: c.kind === 'tooling' ? 'tooling' : 'concept', index: cats.length };
      cats.push(catById[c.id]);
    });
    items.forEach(function (it) {                       // categories the data forgot to declare
      if (it.category && !catById[it.category]) {
        catById[it.category] = { id: it.category, label: it.category, kind: it.kind, index: cats.length };
        cats.push(catById[it.category]);
      }
    });
    var tagSet = {};
    items.forEach(function (it) {
      var c = catById[it.category];
      it.catLabel = c ? c.label : '';
      it.catIndex = c ? c.index : 9999;
      it.lcNotes = lc(it.notes); it.lcTags = it.tags.join(' '); it.lcCat = lc(it.catLabel); it.lcTitle = lc(it.title);
      it.text = [PF.map(function (pf) { return it.lcName[pf]; }).join(' '), it.lcNotes, it.lcTags, it.lcCat].join(' ');
      it.tags.forEach(function (t) { tagSet[t] = 1; });
    });
    return { items: items, cats: cats, catById: catById, tags: Object.keys(tagSet).sort() };
  }

  /* ---------------- state <-> URL ---------------- */
  function readUrl() {
    var g = AIS.params.get;
    var f = g('from'), t = g('to');
    state.from = PF.indexOf(f) >= 0 ? f : DEF_FROM;
    state.to = PF.indexOf(t) >= 0 ? t : DEF_TO;
    if (state.from === state.to) state.to = state.from === DEF_TO ? DEF_FROM : DEF_TO;
    state.q = g('q');
    state.kind = KINDS.indexOf(g('kind')) >= 0 ? g('kind') : '';
    state.cat = g('cat');
    state.tag = lc(g('tag'));
    state.sort = g('sort') === 'az' ? 'az' : 'cat';
    state.showMissing = g('missing') === '1';
  }

  function paramObject(explicit) {
    return {
      q: state.q.trim() || null,
      from: explicit || state.from !== DEF_FROM ? state.from : null,
      to: explicit || state.to !== DEF_TO ? state.to : null,
      kind: state.kind || null,
      cat: state.cat || null,
      tag: state.tag || null,
      sort: state.sort === 'az' ? 'az' : null,
      missing: state.showMissing ? '1' : null
    };
  }
  function syncUrl() { AIS.params.set(paramObject(false)); }

  function shareUrl() {
    var o = paramObject(true), p = new URLSearchParams();
    Object.keys(o).forEach(function (k) { if (o[k] != null) p.set(k, o[k]); });
    var qs = p.toString();
    return location.origin + location.pathname + (qs ? '?' + qs : '') + location.hash;
  }

  /* ---------------- filtering / ranking ---------------- */
  function scoreItems() {
    var toks = AIS.tokens(state.q);
    data.items.forEach(function (it) {
      if (!toks.length) { it.score = 1; return; }
      var from = it.p[state.from], to = it.p[state.to];
      var s = AIS.score(state.q, { title: (from ? from.name : '') + ' ' + it.title, text: it.text });
      if (s && to) toks.forEach(function (t) { if (it.lcName[state.to].indexOf(t) !== -1) s += 2; });
      it.score = s;
    });
  }

  function passes(it, skip) {
    if (!it.score) return false;
    if (!skip.kind && state.kind && it.kind !== state.kind) return false;
    if (!skip.cat && state.cat && it.category !== state.cat) return false;
    if (!skip.tag && state.tag && it.tags.indexOf(state.tag) < 0) return false;
    if (!skip.from && !state.q.trim() && !state.showMissing && !it.p[state.from]) return false;
    return true;
  }
  function count(skip) { var n = 0; data.items.forEach(function (it) { if (passes(it, skip)) n++; }); return n; }

  function firstChar(it) {
    var n = it.p[state.from] ? it.p[state.from].name.replace(/^[^A-Za-z0-9]+/, '') : '';
    if (!n) return '~';
    var c = n.charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  function effectiveSort() { return state.q.trim() ? 'rel' : state.sort; }

  function computeView() {
    scoreItems();
    view = data.items.filter(function (it) { return passes(it, {}); });
    missingHidden = state.q.trim() || state.showMissing ? 0 : data.items.filter(function (it) {
      return passes(it, { from: 1 }) && !it.p[state.from];
    }).length;
    var mode = effectiveSort();
    view.forEach(function (it) {
      if (mode === 'cat') it.group = { key: 'c-' + it.category, label: it.catLabel || 'Other', kind: it.kind };
      else if (mode === 'az') { var ch = firstChar(it); it.group = { key: 'l-' + ch, label: ch === '~' ? 'No entry on this platform' : ch, letter: ch }; }
      else it.group = null;
    });
    view.sort(function (a, b) {
      if (mode === 'rel') return (b.score - a.score) || (a.order - b.order);
      if (mode === 'cat') return (a.catIndex - b.catIndex) || (a.order - b.order);
      var an = a.p[state.from] ? a.p[state.from].name.replace(/^[^A-Za-z0-9]+/, '') : '￿';
      var bn = b.p[state.from] ? b.p[state.from].name.replace(/^[^A-Za-z0-9]+/, '') : '￿';
      return an.localeCompare(bn, 'en', { sensitivity: 'base' }) || (a.order - b.order);
    });
  }

  /* which hidden-from-view fields matched the query (anything other than the "from" name and the title) */
  function matchHints(it) {
    var toks = AIS.tokens(state.q);
    if (!toks.length) return [];
    function has(s) { return toks.some(function (t) { return s.indexOf(t) !== -1; }); }
    var out = [];
    PF.forEach(function (pf) {
      if (pf !== state.from && it.p[pf] && has(it.lcName[pf])) out.push(PF_LABEL[pf] + ' name');
    });
    if (has(it.lcNotes)) out.push('notes');
    if (has(it.lcTags)) out.push('tags');
    if (has(it.lcCat)) out.push('category');
    return out;
  }

  /* ---------------- rendering: rows ---------------- */
  function termHtml(entry, hl) {
    var text = hl ? AIS.highlight(entry.name, state.q) : esc(entry.name);
    if (entry.url) {
      return '<a href="' + esc(entry.url) + '" target="_blank" rel="noopener noreferrer">' + text +
        '<span class="eq-ext" aria-hidden="true">↗</span><span class="sr-only"> (opens official docs in a new tab)</span></a>';
    }
    return text;
  }

  function cellHtml(entry, pf) {
    if (!entry) {
      return '<div class="eq-nodirect"><span class="badge warn">No direct equivalent</span>' +
        '<span class="eq-sub">No ' + esc(PF_LABEL[pf]) + ' entry listed. See the notes.</span></div>';
    }
    if (isNoDirect(entry.name)) {
      var closest = closestOf(entry.name);
      return '<div class="eq-nodirect"><span class="badge warn">No direct equivalent</span>' +
        (closest ? '<span class="eq-sub">Closest idea:</span><span class="eq-term">' + termHtml({ name: closest, url: entry.url }, true) + '</span>' : '') +
        '</div>';
    }
    return '<div class="eq-term">' + termHtml(entry, true) + '</div>';
  }

  function rowHtml(it) {
    var fromE = it.p[state.from], toE = it.p[state.to];
    var fromCell = fromE ? cellHtml(fromE, state.from) : '<span class="eq-none">No ' + esc(PF_LABEL[state.from]) + ' entry listed</span>';
    var hints = matchHints(it);
    var tags = it.tags.map(function (t) {
      return '<button type="button" class="eq-tag" data-tag="' + esc(t) + '" title="Filter by tag: ' + esc(t) + '">' + AIS.highlight(t, state.q) + '</button>';
    }).join('');
    return '<tr class="eq-row" id="' + esc(it.id) + '">' +
      '<td class="eq-from"><span class="pf pf-' + state.from + ' eq-lbl">' + esc(PF_LABEL[state.from]) + '</span>' + fromCell + '</td>' +
      '<td class="eq-arrow" aria-hidden="true"><span class="eq-arr-r">→</span><span class="eq-arr-d">↓</span></td>' +
      '<td class="eq-to"><span class="pf pf-' + state.to + ' eq-lbl">' + esc(PF_LABEL[state.to]) + '</span>' + cellHtml(toE, state.to) + '</td>' +
      '<td class="eq-info">' +
        '<div class="eq-title"><span>' + AIS.highlight(it.title, state.q) + '</span>' +
          '<span class="eq-cat">' + esc(it.catLabel) + (state.kind ? '' : (it.catLabel ? ' · ' : '') + (it.kind === 'tooling' ? 'Tooling' : 'Concept')) + '</span>' +
          '<a class="eq-anchor" href="#' + esc(encodeURIComponent(it.id)) + '" aria-label="Permalink to ' + esc(it.title) + '" title="Permalink">#</a></div>' +
        (it.notes ? '<p class="eq-notes">' + AIS.highlight(it.notes, state.q) + '</p>' : '') +
        (tags || hints.length ? '<div class="eq-meta">' + tags +
          (hints.length ? '<span class="eq-matched">Matched in: <strong>' + esc(hints.join(', ')) + '</strong></span>' : '') + '</div>' : '') +
      '</td></tr>';
  }

  function groupHtml(g) {
    return '<tr class="eq-group"><th class="eq-group-h" colspan="4" scope="colgroup" id="grp-' + esc(g.key) + '">' + esc(g.label) +
      (g.kind ? '<span class="badge">' + (g.kind === 'tooling' ? 'Tooling' : 'Concept') + '</span>' : '') + '</th></tr>';
  }

  function chunkHtml(a, b) {
    var out = [], last = a > 0 && view[a - 1].group ? view[a - 1].group.key : null;
    for (var i = a; i < b && i < view.length; i++) {
      var g = view[i].group;
      if (g && g.key !== last) { out.push(groupHtml(g)); last = g.key; }
      out.push(rowHtml(view[i]));
    }
    return out.join('');
  }

  function paintHead() {
    el.thead.innerHTML =
      '<th scope="col"><span class="pf pf-' + state.from + '">' + esc(PF_LABEL[state.from]) + '</span></th>' +
      '<th scope="col"><span class="sr-only">maps to</span></th>' +
      '<th scope="col"><span class="pf pf-' + state.to + '">' + esc(PF_LABEL[state.to]) + '</span></th>' +
      '<th scope="col"><span class="pf muted">Concept and gotchas</span></th>';
  }

  function paintMore() {
    var remaining = view.length - Math.min(state.shown, view.length);
    el.moreWrap.hidden = remaining <= 0;
    if (remaining > 0) el.more.textContent = 'Show ' + Math.min(CHUNK, remaining) + ' more (' + remaining + ' remaining)';
  }

  function paintList() {
    var has = view.length > 0;
    el.list.hidden = !has;
    if (!has) { el.moreWrap.hidden = true; el.body.innerHTML = ''; paintEmpty(); return; }
    el.empty.hidden = true;
    paintHead();
    el.body.innerHTML = chunkHtml(0, Math.min(state.shown, view.length));
    paintMore();
  }

  function paintEmpty() {
    var q = state.q.trim(), qe = encodeURIComponent(q);
    var hasFilters = q || state.kind || state.cat || state.tag;
    var html = '<p><strong>' + (q ? 'No equivalents match “' + esc(q) + '”' : 'Nothing matches these filters') + '.</strong></p>';
    if (missingHidden === 0 && !q && !hasFilters) html = '<p><strong>No entries to show for ' + esc(PF_LABEL[state.from]) + '.</strong></p>';
    html += '<p class="small">Try another spelling, a different platform name, or fewer filters.</p>';
    html += '<div class="eq-empty-links">' +
      (hasFilters ? '<button type="button" class="btn" data-act="clear">Clear filters</button>' : '') +
      (missingHidden > 0 ? '<button type="button" class="btn" data-act="missing">Show ' + plural(missingHidden, 'entry', 'entries') + ' with no ' + esc(PF_LABEL[state.from]) + ' mapping</button>' : '') +
      '<a class="btn" href="' + esc(AIS.url('components/') + (q ? '?q=' + qe : '')) + '">Search Components' + (q ? ' for “' + esc(q) + '”' : '') + '</a>' +
      '<a class="btn" href="' + esc(AIS.url('libraries/') + (q ? '?q=' + qe : '')) + '">Search Libraries' + (q ? ' for “' + esc(q) + '”' : '') + '</a>' +
      '</div>';
    el.empty.innerHTML = html;
    el.empty.hidden = false;
  }

  /* ---------------- rendering: controls ---------------- */
  function platformOptions(sel, value) {
    sel.innerHTML = PF.map(function (pf) {
      return '<option value="' + pf + '"' + (pf === value ? ' selected' : '') + '>' + esc(PF_LABEL[pf]) + '</option>';
    }).join('');
  }

  function keepFocus(container, fn) {
    var a = document.activeElement, key = a && container.contains(a) ? a.getAttribute('data-key') : null;
    fn();
    if (key) { var n = container.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]'); if (n && !n.disabled) n.focus(); }
  }

  function paintControls() {
    platformOptions(el.from, state.from);
    platformOptions(el.to, state.to);

    // kind segments
    var kindCounts = { concept: 0, tooling: 0 };
    data.items.forEach(function (it) { if (passes(it, { kind: 1, cat: 1 })) kindCounts[it.kind]++; });
    Array.prototype.forEach.call(el.kind.querySelectorAll('button'), function (b) {
      var k = b.getAttribute('data-kind');
      b.setAttribute('aria-pressed', String(k === state.kind));
      b.querySelector('[data-count]').textContent = k ? kindCounts[k] : kindCounts.concept + kindCounts.tooling;
    });

    // category chips (only categories of the chosen kind)
    var catCounts = {};
    data.items.forEach(function (it) { if (passes(it, { cat: 1 })) catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
    var total = 0; Object.keys(catCounts).forEach(function (k) { total += catCounts[k]; });
    keepFocus(el.cats, function () {
      var html = '<button type="button" class="chip" data-key="all" data-cat="" aria-pressed="' + (state.cat === '') + '">All categories <span class="count">' + total + '</span></button>';
      data.cats.forEach(function (c) {
        if (state.kind && c.kind !== state.kind) return;
        var n = catCounts[c.id] || 0, on = state.cat === c.id;
        html += '<button type="button" class="chip" data-key="c-' + esc(c.id) + '" data-cat="' + esc(c.id) + '" aria-pressed="' + on + '"' +
          (n === 0 && !on ? ' disabled' : '') + '>' + esc(c.label) + ' <span class="count">' + n + '</span></button>';
      });
      el.cats.innerHTML = html;
    });

    // tag select
    var tagCounts = {};
    data.items.forEach(function (it) { if (passes(it, { tag: 1 })) it.tags.forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
    var th = '<option value="">All tags</option>';
    data.tags.forEach(function (t) {
      var n = tagCounts[t] || 0;
      if (n === 0 && t !== state.tag) return;
      th += '<option value="' + esc(t) + '"' + (t === state.tag ? ' selected' : '') + '>' + esc(t) + ' (' + n + ')</option>';
    });
    el.tag.innerHTML = th;
    el.tag.value = state.tag;

    // sort
    var searching = !!state.q.trim();
    el.sort.innerHTML = searching
      ? '<option>Best match first</option>'
      : '<option value="cat"' + (state.sort === 'cat' ? ' selected' : '') + '>By category</option><option value="az"' + (state.sort === 'az' ? ' selected' : '') + '>A–Z by ' + esc(PF_LABEL[state.from]) + ' name</option>';
    el.sort.disabled = searching;

    // A-Z jump bar
    var show = effectiveSort() === 'az' && view.length > 0;
    el.az.hidden = !show;
    if (show) {
      var present = {};
      view.forEach(function (it) { if (it.group && it.group.letter) present[it.group.letter] = 1; });
      var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
      el.az.innerHTML = letters.map(function (l) {
        return '<button type="button" data-letter="' + l + '"' + (present[l] ? '' : ' disabled') + ' aria-label="Jump to ' + l + '">' + l + '</button>';
      }).join('');
    }

    var anyFilter = state.q.trim() || state.kind || state.cat || state.tag || state.showMissing;
    el.reset.hidden = !anyFilter;
  }

  function paintStatus() {
    var q = state.q.trim();
    var shown = Math.min(state.shown, view.length);
    var txt = view.length === 0
      ? 'No results'
      : (shown < view.length ? 'Showing ' + shown + ' of ' + view.length : 'Showing ' + plural(view.length, 'result', 'results'));
    txt += ' · ' + PF_LABEL[state.from] + ' → ' + PF_LABEL[state.to] + (q ? ' · “' + q + '”' : '');
    el.count.textContent = txt;

    if (missingHidden > 0) {
      el.hidden.hidden = false;
      el.hidden.innerHTML = esc(plural(missingHidden, 'entry is', 'entries are')) + ' hidden because ' + (missingHidden === 1 ? 'it has' : 'they have') +
        ' no ' + esc(PF_LABEL[state.from]) + ' mapping. <button type="button" data-act="missing">Show ' + (missingHidden === 1 ? 'it' : 'them') + '</button>';
    } else if (state.showMissing && !q && state.from !== 'android' && state.from !== 'ios') {
      el.hidden.hidden = false;
      el.hidden.innerHTML = 'Including entries with no ' + esc(PF_LABEL[state.from]) + ' mapping. <button type="button" data-act="nomissing">Hide them</button>';
    } else el.hidden.hidden = true;
  }

  /* ---------------- orchestration ---------------- */
  function renderAll() {
    computeView();
    paintControls();
    paintList();
    paintStatus();
    syncUrl();
  }

  function resetShown() { state.shown = CHUNK; }

  function clearFilters() {
    state.q = ''; state.kind = ''; state.cat = ''; state.tag = ''; state.showMissing = false;
    el.q.value = '';
    resetShown();
    renderAll();
  }

  function validateAgainstData() {
    if (state.cat && !data.catById[state.cat]) state.cat = '';
    if (state.cat && state.kind && data.catById[state.cat].kind !== state.kind) state.cat = '';
    if (state.tag && data.tags.indexOf(state.tag) < 0) state.tag = '';
  }

  /* make sure item `id` is rendered (clearing filters that hide it); returns its index in view or -1 */
  function revealItem(id) {
    var item = null;
    data.items.forEach(function (it) { if (it.id === id) item = it; });
    if (!item) return -1;
    computeView();
    if (view.indexOf(item) < 0) {
      state.q = ''; state.kind = ''; state.cat = ''; state.tag = '';
      el.q.value = '';
      computeView();
      if (view.indexOf(item) < 0) { state.showMissing = true; computeView(); }
    }
    var idx = view.indexOf(item);
    if (idx >= state.shown) state.shown = idx + 1 + CHUNK;
    return idx;
  }

  function hashId() {
    var h = location.hash.slice(1);
    if (!h) return '';
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  function applyHash(scroll) {
    Array.prototype.forEach.call(el.body.querySelectorAll('.eq-hit'), function (n) { n.classList.remove('eq-hit'); });
    var id = hashId();
    if (!id || !data) return;
    if (!document.getElementById(id) || !document.getElementById(id).classList.contains('eq-row')) {
      if (revealItem(id) < 0) return;
      renderAll();
    }
    var row = document.getElementById(id);
    if (!row || !row.classList.contains('eq-row')) return;
    row.classList.add('eq-hit');
    if (scroll) row.scrollIntoView({ block: 'center' });
  }

  function jumpTo(letter) {
    var idx = -1;
    for (var i = 0; i < view.length; i++) if (view[i].group && view[i].group.letter === letter) { idx = i; break; }
    if (idx < 0) return;
    if (idx >= state.shown) {
      var prev = Math.min(state.shown, view.length);
      state.shown = idx + CHUNK;
      el.body.insertAdjacentHTML('beforeend', chunkHtml(prev, Math.min(state.shown, view.length)));
      paintMore(); paintStatus();
    }
    var h = document.getElementById('grp-l-' + letter);
    if (h) h.scrollIntoView({ block: 'start' });
  }

  function copyLink() {
    var url = shareUrl(), done = function (ok) {
      el.copy.textContent = ok ? 'Link copied' : 'Copy failed';
      setTimeout(function () { el.copy.textContent = 'Copy link'; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(fallbackCopy(url)); });
    } else done(fallbackCopy(url));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------------- events ---------------- */
  function setFrom(v) { if (v === state.to) state.to = state.from; state.from = v; }
  function setTo(v) { if (v === state.from) state.from = state.to; state.to = v; }

  function bind() {
    el.q.addEventListener('input', AIS.debounce(function () {
      state.q = el.q.value; resetShown(); if (data) renderAll();
    }, 120));
    el.from.addEventListener('change', function () { setFrom(el.from.value); resetShown(); if (data) renderAll(); });
    el.to.addEventListener('change', function () { setTo(el.to.value); resetShown(); if (data) renderAll(); });
    el.swap.addEventListener('click', function () {
      var t = state.from; state.from = state.to; state.to = t; resetShown(); if (data) renderAll();
    });
    el.kind.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]'); if (!b || !data) return;
      state.kind = b.getAttribute('data-kind');
      if (state.cat && state.kind && data.catById[state.cat] && data.catById[state.cat].kind !== state.kind) state.cat = '';
      resetShown(); renderAll();
    });
    el.cats.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]'); if (!b || !data) return;
      state.cat = b.getAttribute('data-cat'); resetShown(); renderAll();
    });
    el.tag.addEventListener('change', function () { state.tag = el.tag.value; resetShown(); if (data) renderAll(); });
    el.sort.addEventListener('change', function () { state.sort = el.sort.value === 'az' ? 'az' : 'cat'; resetShown(); if (data) renderAll(); });
    el.az.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-letter]'); if (b && !b.disabled) jumpTo(b.getAttribute('data-letter'));
    });
    el.body.addEventListener('click', function (e) {
      var t = e.target.closest('button[data-tag]'); if (!t) return;
      state.tag = t.getAttribute('data-tag'); resetShown(); renderAll();
      el.list.scrollIntoView({ block: 'start' });
    });
    el.more.addEventListener('click', function () {
      var prev = Math.min(state.shown, view.length);
      state.shown = prev + CHUNK;
      el.body.insertAdjacentHTML('beforeend', chunkHtml(prev, Math.min(state.shown, view.length)));
      paintMore(); paintStatus();
      var first = el.body.querySelectorAll('.eq-row')[prev];
      var link = first && first.querySelector('a, button'); if (link) link.focus({ preventScroll: false });
    });
    el.reset.addEventListener('click', clearFilters);
    el.copy.addEventListener('click', copyLink);
    el.retry.addEventListener('click', load);
    function act(e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'clear') clearFilters();
      else if (a === 'missing') { state.showMissing = true; resetShown(); renderAll(); }
      else if (a === 'nomissing') { state.showMissing = false; resetShown(); renderAll(); }
    }
    el.empty.addEventListener('click', act);
    el.hidden.addEventListener('click', act);
    window.addEventListener('hashchange', function () { applyHash(true); });
    window.addEventListener('popstate', function () { if (data) { readUrl(); el.q.value = state.q; validateAgainstData(); resetShown(); renderAll(); } });
  }

  /* ---------------- load ---------------- */
  function load() {
    el.error.hidden = true; el.loading.hidden = false; el.list.hidden = true; el.empty.hidden = true; el.moreWrap.hidden = true;
    el.count.textContent = 'Loading…';
    AIS.fetchJSON(DATA_PATH).then(function (raw) {
      data = normalize(raw);
      if (!data.items.length) throw new Error('The data file contains no items.');
      el.loading.hidden = true;
      validateAgainstData();
      var nc = data.items.filter(function (i) { return i.kind === 'concept'; }).length;
      el.intro.textContent = 'Look up what a concept or tool is called on the other platform: ' + nc + ' concepts and ' +
        (data.items.length - nc) + ' tooling entries. Pick the platform you know, pick the one you are moving to, and search.';
      var id = hashId();
      if (id) revealItem(id);
      renderAll();
      if (id) applyHash(true);
    }).catch(function (err) {
      data = null;
      el.loading.hidden = true; el.list.hidden = true; el.empty.hidden = true; el.moreWrap.hidden = true;
      el.errorMsg.textContent = String(err && err.message ? err.message : err);
      el.error.hidden = false;
      el.count.textContent = 'Failed to load.';
    });
  }

  readUrl();
  el.q.value = state.q;
  platformOptions(el.from, state.from);
  platformOptions(el.to, state.to);
  bind();
  load();
})();
