/* index.js - restores behavior: dark-mode sync, search, drawer, typewriter, navigation */

/* ---------- Utility: DOMContentLoaded single init ---------- */
document.addEventListener("DOMContentLoaded", () => {

const topToggle = document.getElementById("dark-mode-toggle-top");
if (topToggle) toggles.push(topToggle);

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

/* Expose functions to global scope (so onclick attr works) */
window.toggleDrawer = toggleDrawer;
window.onContributorListJoinClick = onContributorListJoinClick;
window.onInterviewQuestionsListClick = onInterviewQuestionsListClick;
window.onShareFeedbackClick = onShareFeedbackClick;
window.onComposeClick = onComposeClick;
window.onBlogsClick = onBlogsClick;
window.search = search;
window.alter = alter;
