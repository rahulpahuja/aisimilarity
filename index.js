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

const quizData = {
    easy: [
        {
            q: "What does \"NLP\" stand for in the context of AI?",
            options: ["Neural Language Programming", "Natural Language Processing", "Networked Learning Protocol", "Numeric Logic Processing"],
            correct: 1
        },
        {
            q: "What is the primary goal of a similarity algorithm?",
            options: ["To sort data alphabetically", "To encrypt messages securely", "To measure how alike two pieces of data are", "To compress files"],
            correct: 2
        },
        {
            q: "Which of the following is an example of a large language model?",
            options: ["MySQL", "Linux", "GPT", "Excel"],
            correct: 2
        },
        {
            q: "What does \"text embedding\" produce?",
            options: ["A formatted HTML document", "A numerical vector representing text", "A translated version of the text", "A compressed archive file"],
            correct: 1
        },
        {
            q: "Which of these fields is most closely related to AI Similarity?",
            options: ["Network Security", "Natural Language Processing", "Database Administration", "Operating Systems"],
            correct: 1
        }
    ],
    medium: [
        {
            q: "Which similarity metric measures the cosine of the angle between two vectors?",
            options: ["Euclidean distance", "Manhattan distance", "Jaccard coefficient", "Cosine similarity"],
            correct: 3
        },
        {
            q: "What does TF-IDF stand for?",
            options: ["Text Frequency – Inverse Document Frequency", "Term Frequency – Inverse Document Frequency", "Token Frequency – Index Document Filter", "Type Factor – Integrated Data Function"],
            correct: 1
        },
        {
            q: "Which of these is a pre-trained transformer model commonly used to generate text embeddings?",
            options: ["ResNet", "VGG16", "BERT", "AlexNet"],
            correct: 2
        },
        {
            q: "What is a vector database primarily used for?",
            options: ["Storing relational tables", "Running SQL queries", "Compiling source code", "Storing and querying high-dimensional embeddings"],
            correct: 3
        },
        {
            q: "In NLP, what is \"tokenization\"?",
            options: ["Encrypting a sentence", "Creating authentication tokens", "Splitting text into smaller units like words or subwords", "Converting text to images"],
            correct: 2
        }
    ],
    hard: [
        {
            q: "What does BERT stand for?",
            options: ["Base Embedding Recurrent Transformer", "Bidirectional Encoder Representations from Transformers", "Binary Encoded Recurrent Training", "Batch-Evaluated Reasoning Tensor"],
            correct: 1
        },
        {
            q: "What is the Jaccard similarity between sets A = {1,2,3} and B = {2,3,4}?",
            options: ["0.25", "0.75", "0.50", "1.00"],
            correct: 2
        },
        {
            q: "In Retrieval-Augmented Generation (RAG), what does the retrieval step do?",
            options: ["Generates a response using only the model's weights", "Fine-tunes the model on new data", "Fetches relevant documents from a knowledge base to ground the response", "Translates queries into SQL"],
            correct: 2
        },
        {
            q: "Which approximate nearest neighbor (ANN) algorithm uses Hierarchical Navigable Small World graphs?",
            options: ["KD-Tree", "FAISS Flat", "IVF-PQ", "HNSW"],
            correct: 3
        },
        {
            q: "What is the main limitation of cosine similarity when comparing documents of different lengths?",
            options: ["It cannot handle negative values", "It only works with binary vectors", "It is too slow for large corpora", "It measures orientation but ignores magnitude, so very different-length documents can appear identical"],
            correct: 3
        }
    ]
};

const quizRatings = [
    { min: 0, max: 0, label: "Novice",    emoji: "🌱" },
    { min: 1, max: 1, label: "Beginner",  emoji: "📖" },
    { min: 2, max: 2, label: "Learner",   emoji: "🔍" },
    { min: 3, max: 3, label: "Proficient",emoji: "⚡" },
    { min: 4, max: 4, label: "Expert",    emoji: "🏆" },
    { min: 5, max: 5, label: "AI Master", emoji: "🧠" }
];

let quizState = { questions: [], current: 0, answers: [], difficulty: '' };

function openQuiz() {
    document.getElementById('quiz-modal').classList.remove('quiz-modal-hidden');
    showScreen('difficulty');
}

function closeQuiz() {
    document.getElementById('quiz-modal').classList.add('quiz-modal-hidden');
}

function showScreen(name) {
    ['difficulty', 'question', 'results'].forEach(s => {
        const el = document.getElementById(`quiz-screen-${s}`);
        el.classList.toggle('quiz-screen-hidden', s !== name);
    });
}

function startQuiz(difficulty) {
    quizState = {
        questions: quizData[difficulty],
        current: 0,
        answers: Array(quizData[difficulty].length).fill(null),
        difficulty
    };
    renderQuestion();
    showScreen('question');
}

function renderQuestion() {
    const { questions, current, answers } = quizState;
    const q = questions[current];
    const total = questions.length;
    const letters = ['A', 'B', 'C', 'D'];

    document.getElementById('quiz-q-text').textContent = q.q;
    document.getElementById('quiz-progress-label').textContent = `${current + 1} / ${total}`;
    document.getElementById('quiz-progress-fill').style.width = `${((current + 1) / total) * 100}%`;

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
    nextBtn.textContent = current === total - 1 ? 'Submit ✓' : 'Next →';
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
    const { questions, answers } = quizState;
    const letters = ['A', 'B', 'C', 'D'];
    let score = 0;
    answers.forEach((ans, i) => { if (ans === questions[i].correct) score++; });

    const rating = quizRatings.find(r => score >= r.min && score <= r.max);
    document.getElementById('quiz-result-emoji').textContent = rating.emoji;
    document.getElementById('quiz-result-score').textContent = `${score} / ${questions.length}`;
    document.getElementById('quiz-result-rating').textContent = rating.label;

    const reviewEl = document.getElementById('quiz-review-list');
    reviewEl.innerHTML = '';
    questions.forEach((q, i) => {
        const correct = answers[i] === q.correct;
        const item = document.createElement('div');
        item.className = `quiz-review-item ${correct ? 'quiz-review-correct' : 'quiz-review-wrong'}`;
        item.innerHTML = `
            <strong>${correct ? '✓' : '✗'} ${q.q}</strong>
            <span class="quiz-review-answer">Correct answer: ${letters[q.correct]}. ${q.options[q.correct]}</span>`;
        reviewEl.appendChild(item);
    });

    showScreen('results');
}

function restartQuiz() {
    showScreen('difficulty');
}

/* ========== END QUIZ MODULE ========== */

/* Expose functions to global scope (so onclick attr works) */
window.toggleDrawer = toggleDrawer;
window.onContributorListJoinClick = onContributorListJoinClick;
window.onInterviewQuestionsListClick = onInterviewQuestionsListClick;
window.onShareFeedbackClick = onShareFeedbackClick;
window.onComposeClick = onComposeClick;
window.onBlogsClick = onBlogsClick;
window.search = search;
window.alter = alter;
window.openQuiz = openQuiz;
window.closeQuiz = closeQuiz;
window.startQuiz = startQuiz;
window.selectOption = selectOption;
window.quizNext = quizNext;
window.restartQuiz = restartQuiz;
