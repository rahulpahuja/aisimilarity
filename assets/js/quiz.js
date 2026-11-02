/* quiz.js - Knowledge Quiz modal for the home page.
 *
 * Markup lives in index.html (#quiz-modal). Opens from any [data-quiz-open] element, from
 * window.AISQuiz.open(), or via the URL param ?quiz=1 (wired in index.js).
 * Data: quiz-data.json (platforms, ratings, questions[platform][difficulty][]), fetched on first open.
 * All data-derived text is written with textContent / DOM nodes (never innerHTML).
 */
(function () {
  'use strict';

  var LETTERS = 'ABCDEFGH';
  var DATA_PATH = 'quiz-data.json';
  var SCREENS = ['loading', 'platform', 'difficulty', 'question', 'results'];

  var modal, container, closeBtn;
  var db = null;
  var loading = null;
  var lastFocus = null;
  var inerted = [];
  var state = { platform: '', difficulty: '', questions: [], current: 0, answers: [] };

  function $(id) { return document.getElementById(id); }

  function loadData() {
    if (db) return Promise.resolve(db);
    if (!loading) {
      var p = window.AIS && window.AIS.fetchJSON
        ? window.AIS.fetchJSON(DATA_PATH)
        : fetch(DATA_PATH).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      loading = p.then(function (d) {
        if (!d || !d.platforms || !d.questions || !Array.isArray(d.ratings)) throw new Error('Unexpected quiz data shape');
        db = d;
        return d;
      });
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  /* ---------- screens + focus ---------- */
  function isOpen() { return modal && !modal.classList.contains('quiz-modal-hidden'); }

  function focusables() {
    return Array.prototype.filter.call(
      container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; }
    );
  }

  function showScreen(name) {
    SCREENS.forEach(function (s) {
      var el = $('quiz-screen-' + s);
      if (el) el.classList.toggle('quiz-screen-hidden', s !== name);
    });
    var screen = $('quiz-screen-' + name);
    if (!screen || !isOpen()) return;
    var target;
    if (name === 'question') target = $('quiz-q-text');
    else if (name === 'results') target = $('quiz-result-score');
    else target = focusables().filter(function (el) { return el !== closeBtn && screen.contains(el); })[0];
    (target || screen).focus({ preventScroll: true });
  }

  /* While the dialog is open the page behind it is inert, so Tab/AT cannot reach it. */
  function setBackgroundInert(on) {
    if (on) {
      inerted = Array.prototype.filter.call(document.body.children, function (el) {
        return el !== modal && el.tagName !== 'SCRIPT' && !el.hasAttribute('inert');
      });
      inerted.forEach(function (el) { el.setAttribute('inert', ''); });
    } else {
      inerted.forEach(function (el) { el.removeAttribute('inert'); });
      inerted = [];
    }
  }

  function onKeydown(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var items = focusables();
    if (!items.length) { e.preventDefault(); container.focus(); return; }
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || active === container || !container.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !container.contains(active))) { e.preventDefault(); first.focus(); }
  }

  /* ---------- open / close ---------- */
  function open(opener) {
    if (!modal) return Promise.resolve();
    if (!isOpen()) {
      lastFocus = opener instanceof Element ? opener : document.activeElement;
      modal.classList.remove('quiz-modal-hidden');
      document.documentElement.classList.add('quiz-open');
      setBackgroundInert(true);
    }
    if (db) { showScreen('platform'); return Promise.resolve(); }

    setLoading(true, 'Loading quiz…');
    showScreen('loading');
    return loadData().then(function () {
      setLoading(false);
      showScreen('platform');
    }, function () {
      setLoading(false, 'Could not load quiz data. Please try again.');
    });
  }

  function setLoading(busy, msg) {
    var spin = modal.querySelector('.quiz-spinner'), text = $('quiz-loading-msg'), retry = $('quiz-retry-btn');
    if (spin) spin.hidden = !busy;
    if (text && msg) text.textContent = msg;
    if (retry) retry.hidden = busy || !msg;
  }

  function close() {
    if (!isOpen()) return;
    modal.classList.add('quiz-modal-hidden');
    document.documentElement.classList.remove('quiz-open');
    setBackgroundInert(false);
    if (window.AIS && new URLSearchParams(location.search).has('quiz')) window.AIS.params.set({ quiz: null });
    var back = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : $('omni-input');
    lastFocus = null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  /* ---------- quiz flow ---------- */
  function selectPlatform(platform) {
    var meta = db && db.platforms[platform];
    if (!meta || !db.questions[platform]) return;
    state.platform = platform;
    $('quiz-diff-platform-name').textContent = meta.label;
    var iconBox = $('quiz-diff-platform-icon');
    iconBox.textContent = '';
    var img = document.createElement('img');
    img.src = meta.icon;
    img.alt = '';
    iconBox.appendChild(img);
    showScreen('difficulty');
  }

  function bandMax() {
    return db.ratings.reduce(function (m, r) { return Math.max(m, r.max); }, 0);
  }

  /* quiz-data.json holds a pool per platform/difficulty (100 questions); the rating bands only
   * cover 0..bandMax() correct answers, so each round is a random sample of that size. */
  function sample(pool, n) {
    var a = pool.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, n);
  }

  function startQuiz(difficulty) {
    var pool = db.questions[state.platform] && db.questions[state.platform][difficulty];
    if (!Array.isArray(pool) || !pool.length) return;
    var questions = sample(pool, Math.min(bandMax() || 5, pool.length));
    state = { platform: state.platform, difficulty: difficulty, questions: questions, current: 0, answers: questions.map(function () { return null; }) };
    renderQuestion();
    showScreen('question');
  }

  function renderQuestion() {
    var q = state.questions[state.current], answers = state.answers, cur = state.current, total = state.questions.length;
    $('quiz-q-text').textContent = q.q;
    $('quiz-progress-label').textContent = (cur + 1) + ' / ' + total;
    $('quiz-progress-fill').style.width = (((cur + 1) / total) * 100) + '%';

    var box = $('quiz-options');
    box.textContent = '';
    q.options.forEach(function (opt, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option' + (answers[cur] === i ? ' quiz-opt-selected' : '');
      btn.setAttribute('aria-pressed', answers[cur] === i ? 'true' : 'false');
      var letter = document.createElement('span');
      letter.className = 'quiz-opt-letter';
      letter.textContent = LETTERS.charAt(i);
      var label = document.createElement('span');
      label.textContent = opt;
      btn.appendChild(letter);
      btn.appendChild(label);
      btn.addEventListener('click', function () { selectOption(i); });
      box.appendChild(btn);
    });

    var next = $('quiz-next-btn');
    next.disabled = answers[cur] === null;
    next.textContent = cur === total - 1 ? 'Submit ✓' : 'Next →';
  }

  function selectOption(i) {
    state.answers[state.current] = i;
    renderQuestion();
    var chosen = $('quiz-options').children[i];
    if (chosen) chosen.focus({ preventScroll: true });
  }

  function next() {
    if (state.answers[state.current] === null) return;
    if (state.current < state.questions.length - 1) {
      state.current++;
      renderQuestion();
      showScreen('question');
    } else {
      showResults();
    }
  }

  function ratingFor(score) {
    var r = db.ratings.filter(function (x) { return score >= x.min && score <= x.max; })[0];
    if (r) return r;
    var sorted = db.ratings.slice().sort(function (a, b) { return a.min - b.min; });
    return score < sorted[0].min ? sorted[0] : sorted[sorted.length - 1];
  }

  function showResults() {
    var qs = state.questions, answers = state.answers, score = 0;
    answers.forEach(function (a, i) { if (a === qs[i].correct) score++; });
    var rating = ratingFor(score);
    var diff = state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1);

    $('quiz-result-emoji').textContent = rating.emoji || '';
    $('quiz-result-score').textContent = score + ' / ' + qs.length;
    $('quiz-result-rating').textContent = rating.label + ' · ' + db.platforms[state.platform].label + ' ' + diff;

    var list = $('quiz-review-list');
    list.textContent = '';
    qs.forEach(function (q, i) {
      var ok = answers[i] === q.correct;
      var item = document.createElement('div');
      item.className = 'quiz-review-item ' + (ok ? 'quiz-review-correct' : 'quiz-review-wrong');
      var head = document.createElement('strong');
      head.textContent = (ok ? '✓ ' : '✗ ') + q.q;
      var ans = document.createElement('span');
      ans.className = 'quiz-review-answer';
      ans.textContent = 'Correct: ' + LETTERS.charAt(q.correct) + '. ' + q.options[q.correct];
      item.appendChild(head);
      item.appendChild(ans);
      list.appendChild(item);
    });
    showScreen('results');
  }

  /* ---------- wiring ---------- */
  function init() {
    modal = $('quiz-modal');
    if (!modal) return;
    container = modal.querySelector('.quiz-container');
    closeBtn = modal.querySelector('.quiz-close-btn');
    container.setAttribute('tabindex', '-1');
    ['quiz-screen-loading', 'quiz-screen-platform', 'quiz-screen-difficulty', 'quiz-screen-question', 'quiz-screen-results'].forEach(function (id) {
      var el = $(id); if (el) el.setAttribute('tabindex', '-1');
    });
    $('quiz-q-text').setAttribute('tabindex', '-1');
    $('quiz-result-score').setAttribute('tabindex', '-1');

    modal.addEventListener('click', function (e) {
      if (e.target === modal) { close(); return; }
      var t = e.target.closest ? e.target.closest('[data-quiz-platform],[data-quiz-diff],[data-quiz-action]') : null;
      if (!t || !modal.contains(t)) return;
      if (t.hasAttribute('data-quiz-platform')) selectPlatform(t.getAttribute('data-quiz-platform'));
      else if (t.hasAttribute('data-quiz-diff')) startQuiz(t.getAttribute('data-quiz-diff'));
      else {
        var a = t.getAttribute('data-quiz-action');
        if (a === 'close') close();
        else if (a === 'back' || a === 'restart') showScreen('platform');
        else if (a === 'next') next();
        else if (a === 'retry') open();
      }
    });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-quiz-open]') : null;
      if (t) { e.preventDefault(); open(t); }
    });
  }

  window.AISQuiz = { open: open, close: close, isOpen: isOpen };
  /* Back-compat aliases for the old global handlers. */
  window.openQuiz = open;
  window.closeQuiz = close;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
