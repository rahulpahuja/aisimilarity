/* index.js - restores behavior: dark-mode sync, search, drawer, typewriter, navigation */

/* ---------- Utility: DOMContentLoaded single init ---------- */
document.addEventListener("DOMContentLoaded", () => {

    // Typewriter initial state
    const titleEl = document.getElementById("title");
    if (titleEl) titleEl.textContent = "";

    // Setup toggles (header + drawer)
    const toggles = [];
    const headerToggle = document.getElementById("dark-mode-toggle");
    const drawerToggle = document.getElementById("dark-mode-toggle-drawer");
    if (headerToggle) toggles.push(headerToggle);
    if (drawerToggle) toggles.push(drawerToggle);

    // Read preference
    const saved = localStorage.getItem("dark-mode") === "enabled";

    // Apply initial state
    document.body.classList.toggle("dark-mode", saved);
    toggles.forEach(t => t.checked = saved);

    // Hook events and keep them in sync
    toggles.forEach(t => {
        t.addEventListener("change", (e) => {
            const checked = e.target.checked;
            document.body.classList.toggle("dark-mode", checked);
            localStorage.setItem("dark-mode", checked ? "enabled" : "disabled");
            // sync others
            toggles.forEach(o => { if (o !== e.target) o.checked = checked; });
        });
    });

    // Drawer close on outside click (optional)
    document.addEventListener('click', (ev) => {
        const drawer = document.getElementById('drawer');
        const menuBtn = document.getElementById('menu-btn');
        if (!drawer || !menuBtn) return;
        if (!drawer.classList.contains('hidden')) {
            // if click outside drawer and not on menu button, close
            if (!drawer.contains(ev.target) && !menuBtn.contains(ev.target)) {
                drawer.classList.add('hidden');
                drawer.setAttribute('aria-hidden', 'true');
            }
        }
    });

    // Start typewriter
    typeWriter();
});

/* ---------- Typewriter ---------- */
let i = 0;
const titleText = "Welcome to AI Similarity";
const speed = 60;

function typeWriter() {
    const el = document.getElementById("title");
    if (!el) return;
    if (i < titleText.length) {
        el.innerHTML += titleText.charAt(i);
        i++;
        setTimeout(typeWriter, speed);
    }
}

/* ---------- Drawer ---------- */
function toggleDrawer() {
    const drawer = document.getElementById('drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden');
    const hidden = drawer.classList.contains('hidden');
    drawer.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

/* ---------- Navigation handlers (preserved) ---------- */
function onContributorListJoinClick() {
    window.location.href = 'https://forms.gle/wjcHvYAdYxPHodTN8';
}
function onInterviewQuestionsListClick() {
    window.location.href = '/iqlist.html';
}
function onShareFeedbackClick() {
    window.location.href = 'https://forms.gle/qMAD5hX2VPjahmLAA';
}
function onComposeClick() {
    window.location.href = '/compose/compose.html';
}
function onBlogsClick() {
    // currently coming soon
    alert('Blogs are coming soon');
}
function onCatchDroidClick() {
    window.location.href = '/droid.html';
}
function onCatchIosClick() {
    window.location.href = '/squircle.html';
}

/* ---------- Search logic (works with explicit <tbody>) ---------- */
function search() {
    const q = document.getElementById('search-query');
    const query = q ? q.value.trim().toLowerCase() : '';
    if (!query) {
        // reload to reset (keeps it simple)
        location.reload();
        return;
    }

    alter("table-data-ui", query);
    alter("table-data-components", query);
    alter("table-data-form", query);
    alter("table-data-net", query);
    alter("table-data-view", query);
}

function alter(id, query) {
    const table = document.getElementById(id);
    if (!table) return;
    // prefer explicit tbody
    const tbody = table.querySelector('tbody') || table;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

/* ========== QUIZ MODULE ========== */

let quizDB = null; // populated from quiz-data.json on first open

let quizState = { platform: '', difficulty: '', questions: [], current: 0, answers: [] };

async function openQuiz() {
    const modal = document.getElementById('quiz-modal');
    modal.classList.remove('quiz-modal-hidden');
    modal.onclick = (e) => { if (e.target === modal) closeQuiz(); };

    if (quizDB) { showScreen('platform'); return; }

    // Load data from JSON on first open
    showScreen('loading');
    try {
        const res = await fetch('quiz-data.json');
        if (!res.ok) throw new Error('Failed to load quiz data');
        quizDB = await res.json();
        showScreen('platform');
    } catch (e) {
        document.getElementById('quiz-loading-msg').textContent = 'Could not load quiz data. Please try again.';
    }
}

function closeQuiz() {
    document.getElementById('quiz-modal').classList.add('quiz-modal-hidden');
}

function showScreen(name) {
    ['loading', 'platform', 'difficulty', 'question', 'results'].forEach(s => {
        const el = document.getElementById(`quiz-screen-${s}`);
        if (el) el.classList.toggle('quiz-screen-hidden', s !== name);
    });
}

function selectPlatform(platform) {
    quizState.platform = platform;
    const meta = quizDB.platforms[platform];
    document.getElementById('quiz-diff-platform-name').textContent = meta.label;
    document.getElementById('quiz-diff-platform-icon').innerHTML =
        `<img src="${meta.icon}" alt="${meta.label}" style="width:44px;height:44px;object-fit:contain;">`;
    showScreen('difficulty');
}

function startQuiz(difficulty) {
    const questions = quizDB.questions[quizState.platform][difficulty];
    quizState = { ...quizState, difficulty, questions, current: 0, answers: Array(questions.length).fill(null) };
    renderQuestion();
    showScreen('question');
}

function renderQuestion() {
    const { questions, current, answers } = quizState;
    const q = questions[current];
    const letters = ['A', 'B', 'C', 'D'];

    document.getElementById('quiz-q-text').textContent = q.q;
    document.getElementById('quiz-progress-label').textContent = `${current + 1} / ${questions.length}`;
    document.getElementById('quiz-progress-fill').style.width = `${((current + 1) / questions.length) * 100}%`;

    const optionsEl = document.getElementById('quiz-options');
    optionsEl.innerHTML = '';
    q.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option' + (answers[current] === i ? ' quiz-opt-selected' : '');
        btn.innerHTML = `<span class="quiz-opt-letter">${letters[i]}</span><span>${opt}</span>`;
        btn.onclick = () => selectOption(i);
        optionsEl.appendChild(btn);
    });

    const nextBtn = document.getElementById('quiz-next-btn');
    nextBtn.disabled = answers[current] === null;
    nextBtn.textContent = current === questions.length - 1 ? 'Submit ✓' : 'Next →';
}

function selectOption(index) {
    quizState.answers[quizState.current] = index;
    renderQuestion();
}

function quizNext() {
    const { questions, current } = quizState;
    if (current < questions.length - 1) {
        quizState.current++;
        renderQuestion();
    } else {
        showResults();
    }
}

function showResults() {
    const { questions, answers, platform, difficulty } = quizState;
    const letters = ['A', 'B', 'C', 'D'];
    let score = 0;
    answers.forEach((ans, i) => { if (ans === questions[i].correct) score++; });

    const rating = quizDB.ratings.find(r => score >= r.min && score <= r.max);
    const platformLabel = quizDB.platforms[platform].label;
    document.getElementById('quiz-result-emoji').textContent = rating.emoji;
    document.getElementById('quiz-result-score').textContent = `${score} / ${questions.length}`;
    document.getElementById('quiz-result-rating').textContent =
        `${rating.label} · ${platformLabel} ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`;

    const reviewEl = document.getElementById('quiz-review-list');
    reviewEl.innerHTML = '';
    questions.forEach((q, i) => {
        const correct = answers[i] === q.correct;
        const item = document.createElement('div');
        item.className = `quiz-review-item ${correct ? 'quiz-review-correct' : 'quiz-review-wrong'}`;
        item.innerHTML = `<strong>${correct ? '✓' : '✗'} ${q.q}</strong>
            <span class="quiz-review-answer">Correct: ${letters[q.correct]}. ${q.options[q.correct]}</span>`;
        reviewEl.appendChild(item);
    });

    showScreen('results');
}

function restartQuiz() {
    showScreen('platform');
}

/* ========== END QUIZ MODULE ========== */

/* Expose functions to global scope (so onclick attr works) */
window.toggleDrawer = toggleDrawer;
window.onContributorListJoinClick = onContributorListJoinClick;
window.onInterviewQuestionsListClick = onInterviewQuestionsListClick;
window.onShareFeedbackClick = onShareFeedbackClick;
window.onComposeClick = onComposeClick;
window.onBlogsClick = onBlogsClick;
window.onCatchDroidClick = onCatchDroidClick;
window.search = search;
window.alter = alter;
window.openQuiz = openQuiz;
window.closeQuiz = closeQuiz;
window.selectPlatform = selectPlatform;
window.startQuiz = startQuiz;
window.selectOption = selectOption;
window.quizNext = quizNext;
window.restartQuiz = restartQuiz;
