/* blog.js — blog index (search + filters) and post-page enhancements (syntax highlighting, copy buttons, TOC).
 * Loaded with `defer` after assets/js/shell.js on blog/index.html and every generated blog/<slug>.html.
 * The syntax highlighter is also exported for Node (tools/build-blog.test.mjs) when loaded via require().
 */
(function () {
  'use strict';

  /* ================================================================
   * Syntax highlighter
   * Tokenises the RAW code text and escapes each token on output, so the result can never contain markup
   * that was not produced here. Token classes (.t-*) are coloured through CSS variables in blog.css.
   *   t-k keyword · t-s string · t-c comment · t-n number · t-t type · t-m annotation/meta · t-a attribute/key
   * ================================================================ */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function set(words) { var o = Object.create(null); words.split(' ').forEach(function (w) { o[w] = true; }); return o; }

  var C_LINE = ['//'];
  var C_BLOCK = [['/*', '*/']];
  var STR_TRIPLE_DQ = { open: '"""', close: '"""', esc: true, multi: true };
  var STR_DQ = { open: '"', close: '"', esc: true, multi: false };
  var STR_SQ = { open: "'", close: "'", esc: true, multi: false };

  var LANGS = {
    kotlin: {
      kw: set('abstract actual annotation as break by catch class companion const constructor continue crossinline data delegate do dynamic else enum expect external false final finally for fun if import in infix init inline inner interface internal is lateinit noinline null object open operator out override package private protected public reified return sealed super suspend tailrec this throw true try typealias val value var vararg when where while'),
      types: true, ann: true, line: C_LINE, block: C_BLOCK, strs: [STR_TRIPLE_DQ, STR_DQ, STR_SQ]
    },
    java: {
      kw: set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try var void volatile while record sealed permits yield'),
      types: true, ann: true, line: C_LINE, block: C_BLOCK, strs: [STR_TRIPLE_DQ, STR_DQ, STR_SQ]
    },
    swift: {
      kw: set('actor any as associatedtype async await break case catch class continue convenience default defer deinit do dynamic else enum extension fallthrough false fileprivate final for func get guard if import in indirect infix init inout internal is lazy let mutating nil nonisolated open operator override postfix precedencegroup prefix private protocol public repeat required rethrows return self Self set some static struct subscript super switch throw throws true try typealias unowned var weak where while willSet didSet'),
      types: true, ann: true, line: C_LINE, block: C_BLOCK, strs: [STR_TRIPLE_DQ, STR_DQ]
    },
    groovy: {
      kw: set('abstract as assert break case catch class const continue def default do else enum extends final finally for goto if implements import in instanceof interface new null package private protected public return static super switch this throw throws trait true false try void while'),
      types: false, ann: true, line: C_LINE, block: C_BLOCK,
      strs: [{ open: "'''", close: "'''", esc: true, multi: true }, STR_TRIPLE_DQ, STR_DQ, STR_SQ]
    },
    toml: {
      kw: set('true false'), types: false, line: ['#'], block: [],
      strs: [{ open: "'''", close: "'''", esc: false, multi: true }, STR_TRIPLE_DQ, STR_DQ, { open: "'", close: "'", esc: false, multi: false }],
      keyRe: /[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*(?=[ \t]*=(?!=))/y, bolRules: [{ re: /\[\[?[^\]\n]+\]\]?/y, cls: 't' }]
    },
    bash: {
      kw: set('if then else elif fi for while until do done case esac in function return export local set unset readonly source exit break continue select'),
      types: false, line: ['#'], lineWordStart: true, block: [], flags: true, vars: true, keyRe: /[A-Za-z_]\w*(?==(?!=))/y,
      strs: [STR_DQ, { open: "'", close: "'", esc: false, multi: false }]
    },
    json: { kw: set('true false null'), types: false, line: [], block: [], strs: [STR_DQ], keyStr: true }
  };

  var RE_NUM = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[A-Za-z]*/y;
  var RE_IDENT = /[A-Za-z_$][\w$]*/y;
  var RE_ANN = /@[A-Za-z_][\w.]*/y;
  var RE_VAR = /\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?!*$-])/y;
  var RE_FLAG = /--?[A-Za-z][\w-]*/y;
  var RE_WS_COLON = /[ \t\r\n]*:/y;

  function sticky(re, s, i) { re.lastIndex = i; return re.exec(s); }
  function isIdentChar(c) { return c !== undefined && /[\w$]/.test(c); }
  function atLineStart(s, i) {
    var k = i - 1;
    while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
    return k < 0 || s[k] === '\n';
  }

  function scan(code, cfg) {
    var out = '', plain = '', i = 0, n = code.length, m;
    function flush() { if (plain) { out += esc(plain); plain = ''; } }
    function tok(cls, text) { flush(); out += '<span class="t-' + cls + '">' + esc(text) + '</span>'; }

    while (i < n) {
      var c = code[i], j, k;

      /* line-start rules (e.g. TOML [tables]) */
      if (cfg.bolRules && atLineStart(code, i)) {
        var hit = false;
        for (k = 0; k < cfg.bolRules.length; k++) {
          m = sticky(cfg.bolRules[k].re, code, i);
          if (m) { tok(cfg.bolRules[k].cls, m[0]); i += m[0].length; hit = true; break; }
        }
        if (hit) continue;
      }

      /* comments */
      var matched = false;
      for (k = 0; k < cfg.line.length; k++) {
        if (code.startsWith(cfg.line[k], i) && (!cfg.lineWordStart || i === 0 || /[\s;|&(]/.test(code[i - 1]))) {
          j = code.indexOf('\n', i);
          if (j === -1) j = n;
          tok('c', code.slice(i, j));
          i = j;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      for (k = 0; k < cfg.block.length; k++) {
        if (code.startsWith(cfg.block[k][0], i)) {
          j = code.indexOf(cfg.block[k][1], i + cfg.block[k][0].length);
          j = j === -1 ? n : j + cfg.block[k][1].length;
          tok('c', code.slice(i, j));
          i = j;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      /* strings (longest opener first: the lists are ordered that way) */
      for (k = 0; k < cfg.strs.length; k++) {
        var st = cfg.strs[k];
        if (!code.startsWith(st.open, i)) continue;
        j = i + st.open.length;
        while (j < n) {
          if (st.esc && code[j] === '\\') { j += 2; continue; }
          if (code.startsWith(st.close, j)) { j += st.close.length; break; }
          if (!st.multi && code[j] === '\n') break;
          j++;
        }
        if (j > n) j = n;
        var text = code.slice(i, j), cls = 's';
        if (cfg.keyStr && sticky(RE_WS_COLON, code, j)) cls = 'a';
        tok(cls, text);
        i = j;
        matched = true;
        break;
      }
      if (matched) continue;

      /* annotations / attributes */
      if (cfg.ann && c === '@' && (m = sticky(RE_ANN, code, i))) { tok('m', m[0]); i += m[0].length; continue; }

      /* shell variables and flags */
      if (cfg.vars && c === '$' && (m = sticky(RE_VAR, code, i))) { tok('a', m[0]); i += m[0].length; continue; }
      if (cfg.flags && c === '-' && (i === 0 || /\s/.test(code[i - 1])) && (m = sticky(RE_FLAG, code, i))) { tok('m', m[0]); i += m[0].length; continue; }

      /* identifiers / keywords / types */
      if (/[A-Za-z_$]/.test(c) && (m = sticky(RE_IDENT, code, i))) {
        var word = m[0], end = i + word.length, kcls = '', km;
        if (cfg.keyRe && (km = sticky(cfg.keyRe, code, i))) { tok('a', km[0]); i += km[0].length; continue; }
        if (cfg.kw[word]) kcls = 'k';
        else if (cfg.types && /^[A-Z]/.test(word)) kcls = 't';
        if (kcls) tok(kcls, word); else plain += word;
        i = end;
        continue;
      }

      /* numbers */
      if (c >= '0' && c <= '9' && !isIdentChar(code[i - 1]) && (m = sticky(RE_NUM, code, i))) { tok('n', m[0]); i += m[0].length; continue; }

      plain += c;
      i++;
    }
    flush();
    return out;
  }

  function scanXml(code) {
    var out = '', plain = '', i = 0, n = code.length, m, j;
    function flush() { if (plain) { out += esc(plain); plain = ''; } }
    function tok(cls, text) { flush(); out += '<span class="t-' + cls + '">' + esc(text) + '</span>'; }
    var NAME = /[A-Za-z_][\w:.-]*/y;

    while (i < n) {
      if (code.startsWith('<!--', i)) {
        j = code.indexOf('-->', i + 4); j = j === -1 ? n : j + 3;
        tok('c', code.slice(i, j)); i = j; continue;
      }
      if (code.startsWith('<![CDATA[', i)) {
        j = code.indexOf(']]>', i + 9); j = j === -1 ? n : j + 3;
        tok('s', code.slice(i, j)); i = j; continue;
      }
      if (code.startsWith('<?', i) || code.startsWith('<!', i)) {
        j = code.indexOf('>', i); j = j === -1 ? n : j + 1;
        tok('m', code.slice(i, j)); i = j; continue;
      }
      if (code[i] === '<' && /[A-Za-z/]/.test(code[i + 1] || '')) {
        var open = code.startsWith('</', i) ? '</' : '<';
        plain += open; i += open.length;
        if ((m = sticky(NAME, code, i))) { tok('k', m[0]); i += m[0].length; }
        while (i < n && code[i] !== '>') {
          var ch = code[i];
          if (ch === '"' || ch === "'") {
            j = code.indexOf(ch, i + 1); j = j === -1 ? n : j + 1;
            tok('s', code.slice(i, j)); i = j; continue;
          }
          if ((m = sticky(NAME, code, i))) { tok('a', m[0]); i += m[0].length; continue; }
          plain += ch; i++;
        }
        if (i < n) { plain += '>'; i++; }
        continue;
      }
      plain += code[i];
      i++;
    }
    flush();
    return out;
  }

  var ALIAS = { kts: 'kotlin', gradle: 'groovy', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'xml' };

  /* highlight(rawCode, lang) -> safe HTML string */
  function highlight(code, lang) {
    code = String(code == null ? '' : code);
    lang = ALIAS[lang] || lang;
    if (lang === 'xml') return scanXml(code);
    if (LANGS[lang]) return scan(code, LANGS[lang]);
    return esc(code);
  }

  /* Node (tests): export and stop. */
  if (typeof module !== 'undefined' && module.exports) { module.exports = { highlight: highlight }; return; }
  if (typeof document === 'undefined') return;

  /* ================================================================
   * Shared helpers
   * ================================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(iso + 'T00:00:00Z'));
    } catch (e) { return iso; }
  }

  /* ================================================================
   * Post page
   * ================================================================ */
  function initPost() {
    /* syntax highlighting */
    $$('pre > code[class^="language-"]').forEach(function (code) {
      var lang = code.className.replace('language-', '');
      var raw = code.textContent;
      code.innerHTML = highlight(raw, lang);
    });

    /* copy buttons */
    var status = document.createElement('div');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    document.body.appendChild(status);

    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
        document.body.removeChild(ta);
      });
    }

    $$('.code-block').forEach(function (fig) {
      var btn = $('.code-copy', fig), code = $('code', fig);
      if (!btn || !code) return;
      btn.hidden = false;
      var timer;
      btn.addEventListener('click', function () {
        copyText(code.textContent).then(function () {
          btn.textContent = 'Copied';
          status.textContent = 'Code copied to clipboard';
        }, function () {
          btn.textContent = 'Copy failed';
          status.textContent = 'Could not copy code';
        }).then(function () {
          clearTimeout(timer);
          timer = setTimeout(function () { btn.textContent = 'Copy'; status.textContent = ''; }, 1800);
        });
      });
    });

    /* TOC: collapsed on small screens, scroll-spy on large */
    var toc = $('#toc details');
    if (toc && window.matchMedia && window.matchMedia('(max-width: 959px)').matches) toc.open = false;

    var links = $$('#toc a[href^="#"]');
    if (links.length && 'IntersectionObserver' in window) {
      var byId = {};
      links.forEach(function (a) { byId[decodeURIComponent(a.getAttribute('href').slice(1))] = a; });
      var current = null;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var a = byId[e.target.id];
          if (!a || a === current) return;
          if (current) current.removeAttribute('aria-current');
          a.setAttribute('aria-current', 'true');
          current = a;
        });
      }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });
      Object.keys(byId).forEach(function (id) { var h = document.getElementById(id); if (h) io.observe(h); });
    }
  }

  /* ================================================================
   * Blog index
   * ================================================================ */
  function initIndex() {
    var AIS = window.AIS;
    var app = $('#blog-app');
    var listEl = $('#posts'), countEl = $('#count'), qEl = $('#q');
    var catsEl = $('#cats'), tagsEl = $('#tags'), clearBtn = $('#clear');
    var CHUNK = 18, TAG_COLLAPSED = 14;

    var posts = [];
    var state = { q: '', cat: '', tag: '', shown: CHUNK, allTags: false };
    var catChips = {}, tagChips = {}, tagOrder = [], moreBtn = null;

    function safeSlug(s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? s : null; }

    function loading() {
      app.setAttribute('aria-busy', 'true');
      var sk = '';
      for (var i = 0; i < 6; i++) sk += '<div class="card skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
      listEl.className = 'post-grid';
      listEl.innerHTML = sk;
      countEl.textContent = 'Loading posts…';
    }

    function failure(err) {
      app.setAttribute('aria-busy', 'false');
      listEl.className = '';
      listEl.innerHTML = '<div class="empty-state" role="alert"><p><strong>Could not load the posts.</strong></p>' +
        '<p class="small">' + AIS.esc(err && err.message ? err.message : 'Unknown error') + '</p>' +
        '<button type="button" class="btn btn-primary" id="retry">Retry</button></div>';
      countEl.textContent = '';
      $('#retry').addEventListener('click', load);
    }

    function haystack(p) { return p.summary + ' ' + p.tags.join(' ') + ' ' + p.category; }

    function matches(p, q, cat, tag) {
      if (cat && p.category !== cat) return 0;
      if (tag && p.tags.indexOf(tag) === -1) return 0;
      return AIS.score(q, { title: p.title, text: haystack(p) });
    }

    function buildFilters() {
      var cats = {}, tags = {};
      posts.forEach(function (p) {
        cats[p.category] = (cats[p.category] || 0) + 1;
        p.tags.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
      });

      catsEl.innerHTML = '';
      catChips = {};
      function mkChip(label, value, container, registry) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('data-value', value);
        b.innerHTML = '<span class="chip-label"></span> <span class="count"></span>';
        $('.chip-label', b).textContent = label;
        container.appendChild(b);
        registry[value] = b;
        return b;
      }
      mkChip('All', '', catsEl, catChips);
      Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || a.localeCompare(b); })
        .forEach(function (c) { mkChip(c, c, catsEl, catChips); });

      tagsEl.innerHTML = '';
      tagChips = {};
      tagOrder = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a] || a.localeCompare(b); });
      tagOrder.forEach(function (t) { mkChip('#' + t, t, tagsEl, tagChips); });
      moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'chip chip-more';
      moreBtn.addEventListener('click', function () { state.allTags = !state.allTags; paintTags(); });
      tagsEl.appendChild(moreBtn);
      tagsEl.hidden = tagOrder.length === 0;
      $('#tags-label').hidden = tagOrder.length === 0;
    }

    function paintTags() {
      var visible = 0;
      tagOrder.forEach(function (t, idx) {
        var show = state.allTags || idx < TAG_COLLAPSED || t === state.tag;
        tagChips[t].hidden = !show;
        if (show) visible++;
      });
      var hiddenCount = tagOrder.length - visible;
      moreBtn.hidden = tagOrder.length <= TAG_COLLAPSED;
      moreBtn.textContent = state.allTags ? 'Fewer tags' : 'All tags (+' + hiddenCount + ')';
      moreBtn.setAttribute('aria-expanded', state.allTags ? 'true' : 'false');
    }

    function updateChips() {
      var cc = {}, tc = {}, allForCat = 0;
      posts.forEach(function (p) {
        if (matches(p, state.q, '', state.tag)) { cc[p.category] = (cc[p.category] || 0) + 1; allForCat++; }
        if (matches(p, state.q, state.cat, '')) p.tags.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; });
      });
      Object.keys(catChips).forEach(function (v) {
        var n = v === '' ? allForCat : (cc[v] || 0), b = catChips[v];
        $('.count', b).textContent = n;
        b.setAttribute('aria-pressed', String(v === state.cat));
        b.classList.toggle('is-empty', n === 0 && v !== state.cat);
      });
      Object.keys(tagChips).forEach(function (t) {
        var n = tc[t] || 0, b = tagChips[t];
        $('.count', b).textContent = n;
        b.setAttribute('aria-pressed', String(t === state.tag));
        b.classList.toggle('is-empty', n === 0 && t !== state.tag);
      });
      paintTags();
    }

    function cardHtml(p, featured) {
      var slug = safeSlug(p.slug);
      if (!slug) return '';
      var tags = p.tags.slice(0, featured ? 5 : 3).map(function (t) { return '<span class="mini-tag">#' + AIS.esc(t) + '</span>'; }).join('');
      return '<a class="card post-card' + (featured ? ' featured' : '') + '" href="' + slug + '.html">' +
        '<span class="post-card-top"><span class="badge">' + AIS.highlight(p.category, state.q) + '</span>' +
        '<span class="small muted">' + (Number(p.readingMinutes) || 1) + ' min read</span></span>' +
        '<h3>' + AIS.highlight(p.title, state.q) + '</h3>' +
        '<p class="muted post-card-summary">' + AIS.highlight(p.summary, state.q) + '</p>' +
        '<span class="post-card-foot small muted"><time datetime="' + AIS.esc(p.date) + '">' + AIS.esc(formatDate(p.date)) + '</time>' + tags + '</span>' +
        (featured ? '<span class="read-more">Read the article &rarr;</span>' : '') +
        '</a>';
    }

    function render() {
      var q = state.q.trim();
      var rows = [];
      posts.forEach(function (p) {
        var s = matches(p, q, state.cat, state.tag);
        if (s) rows.push({ p: p, s: s });
      });
      rows.sort(function (a, b) { return (q ? b.s - a.s : 0) || a.p.order - b.p.order; });

      var filtered = !!(q || state.cat || state.tag);
      clearBtn.hidden = !filtered;
      app.setAttribute('aria-busy', 'false');
      updateChips();

      var total = posts.length;
      countEl.textContent = filtered
        ? rows.length + ' of ' + total + ' post' + (total === 1 ? '' : 's')
        : total + ' post' + (total === 1 ? '' : 's');

      if (!rows.length) {
        listEl.className = '';
        listEl.innerHTML = '<div class="empty-state"><p><strong>No posts match' + (q ? ' “' + AIS.esc(q) + '”' : ' these filters') + '.</strong></p>' +
          '<p class="small">Try fewer words, or remove a category or tag filter.</p>' +
          '<button type="button" class="btn" id="empty-clear">Clear search and filters</button></div>';
        $('#empty-clear').addEventListener('click', clearAll);
        return;
      }

      var visible = rows.slice(0, state.shown);
      var html = visible.map(function (r, idx) { return cardHtml(r.p, !filtered && idx === 0); }).join('');
      if (rows.length > visible.length) {
        html += '<div class="more-wrap"><button type="button" class="btn" id="show-more">Show more (' + (rows.length - visible.length) + ' left)</button></div>';
      }
      listEl.className = 'post-grid';
      listEl.innerHTML = html;
      var more = $('#show-more');
      if (more) more.addEventListener('click', function () { state.shown += CHUNK; render(); });
    }

    function sync() {
      AIS.params.set({ q: state.q.trim(), cat: state.cat, tag: state.tag });
    }

    function setFilter(key, value) {
      state[key] = state[key] === value ? '' : value;
      state.shown = CHUNK;
      sync();
      render();
    }

    function clearAll() {
      state.q = ''; state.cat = ''; state.tag = ''; state.shown = CHUNK;
      qEl.value = '';
      sync();
      render();
      qEl.focus();
    }

    function wire() {
      qEl.addEventListener('input', AIS.debounce(function () {
        state.q = qEl.value;
        state.shown = CHUNK;
        sync();
        render();
      }, 100));
      qEl.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && qEl.value) { e.preventDefault(); clearAll(); }
      });
      catsEl.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-value]');
        if (!b) return;
        var v = b.getAttribute('data-value');
        if (v === '') { state.cat = ''; state.shown = CHUNK; sync(); render(); } else setFilter('cat', v);
      });
      tagsEl.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-value]');
        if (b) setFilter('tag', b.getAttribute('data-value'));
      });
      clearBtn.addEventListener('click', clearAll);
    }

    function load() {
      loading();
      AIS.fetchJSON('blog/posts.json').then(function (data) {
        if (!Array.isArray(data)) throw new Error('posts.json has an unexpected shape');
        posts = data.filter(function (p) { return p && typeof p.slug === 'string' && typeof p.title === 'string'; })
          .map(function (p) {
            return {
              slug: p.slug, title: p.title, date: String(p.date || ''), order: Number(p.order) || 0,
              category: String(p.category || ''), tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
              summary: String(p.summary || ''), readingMinutes: p.readingMinutes
            };
          })
          .sort(function (a, b) { return a.order - b.order; });
        if (!posts.length) {
          app.setAttribute('aria-busy', 'false');
          listEl.className = '';
          listEl.innerHTML = '<div class="empty-state"><p>No posts have been published yet.</p></div>';
          countEl.textContent = '';
          return;
        }
        buildFilters();
        render();
      }).catch(failure);
    }

    state.q = AIS.params.get('q');
    state.cat = AIS.params.get('cat');
    state.tag = AIS.params.get('tag');
    qEl.value = state.q;
    wire();
    load();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('blog-app') && window.AIS) initIndex();
    else if (document.querySelector('.post')) initPost();
  });
})();
