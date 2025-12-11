/**
 * compose.js — FINAL FIXED VERSION
 * - Loads one JSON per category
 * - Global search index
 * - Animated tab indicator
 * - Swipe navigation
 * - Debounced search
 * - Fully fixed light/dark mode button (no duplicates)
 */

/* ------------------ Config ------------------ */
const CATEGORIES = [
  "layouts", "inputs", "buttons", "selectors", "navigation",
  "display", "accessibility", "state", "storage", "networking",
  "permissions", "sensors", "notifications", "security", "devtools",
  "utilities", "platform", "animations", "dragdrop", "text",
  "gestures", "overlays"
];
const DATA_CACHE = {};
let SEARCH_INDEX = [];

/* DOM refs */
const tabContainer = document.getElementById("tabs");
const resultsContainer = document.getElementById("results");
const searchInput = document.getElementById("search");
const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");

let indicatorEl = null;
let activeCategory = null;

/* ------------------ Utilities ------------------ */
const cap = str => str.charAt(0).toUpperCase() + str.slice(1);
const sleep = ms => new Promise(res => setTimeout(res, ms));

/* ------------------ THEME SYSTEM (FINAL WORKING) ------------------ */

function applyTheme(theme) {
  const isLight = theme === "light";

  if (isLight) {
    document.body.classList.add("theme-light");
    themeIcon.textContent = "🌙";
  } else {
    document.body.classList.remove("theme-light");
    themeIcon.textContent = "☀️";
  }

  localStorage.setItem("compose_theme", theme);
}

(function initializeTheme() {
  const saved = localStorage.getItem("compose_theme");

  if (saved) {
    applyTheme(saved);
  } else {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight ? "light" : "dark");
  }
})();

themeToggle.addEventListener("click", () => {
  const isLight = document.body.classList.contains("theme-light");
  applyTheme(isLight ? "dark" : "light");
});

/* ------------------ Data Fetching ------------------ */
async function fetchCategory(category) {
  if (DATA_CACHE[category]) return DATA_CACHE[category];

  try {
    const resp = await fetch(`${category}.json`, { cache: "no-store" });
    if (!resp.ok) throw new Error(resp.status);
    const json = await resp.json();
    const items = json.items || json;

    DATA_CACHE[category] = { items };
    return DATA_CACHE[category];
  } catch (e) {
    console.error("Error loading category:", category, e);
    return null;
  }
}

async function loadAllDataInBackground() {
  SEARCH_INDEX = [];

  for (let cat of CATEGORIES) {
    const data = await fetchCategory(cat);
    if (data && data.items) {
      SEARCH_INDEX.push(
        ...data.items.map(item => ({ ...item, __category: cat }))
      );
    }
    await sleep(60);
  }

  console.log("Search index ready:", SEARCH_INDEX.length);
  searchInput.placeholder = `Search ${SEARCH_INDEX.length} components...`;
}

/* ------------------ Tabs + Indicator ------------------ */
function renderTabs() {
  tabContainer.innerHTML = "";

  indicatorEl = document.createElement("div");
  indicatorEl.className = "tab-indicator";
  tabContainer.appendChild(indicatorEl);

  CATEGORIES.forEach((cat, i) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.dataset.category = cat;
    tab.dataset.index = i;
    tab.textContent = cap(cat);

    tab.onclick = () => activateTab(cat, true);

    tabContainer.appendChild(tab);
  });
}

function moveIndicatorToTab(tabEl) {
  if (!tabEl || !indicatorEl) return;

  const rect = tabEl.getBoundingClientRect();
  const parentRect = tabContainer.getBoundingClientRect();

  const left = rect.left - parentRect.left + tabContainer.scrollLeft;
  const width = rect.width;

  indicatorEl.style.left = `${left}px`;
  indicatorEl.style.width = `${width}px`;

  // auto-scroll into view
  const padding = 40;
  const visibleLeft = tabContainer.scrollLeft;
  const visibleRight = visibleLeft + tabContainer.clientWidth;

  if (left < visibleLeft + padding) {
    tabContainer.scrollTo({ left: left - padding, behavior: "smooth" });
  } else if (left + width > visibleRight - padding) {
    tabContainer.scrollTo({ left: left + width - tabContainer.clientWidth + padding, behavior: "smooth" });
  }
}

async function activateTab(category, userTriggered = false) {
  activeCategory = category;

  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.category === category);
  });

  const activeTabEl = tabContainer.querySelector(`[data-category="${category}"]`);
  moveIndicatorToTab(activeTabEl);

  if (userTriggered) searchInput.value = "";

  resultsContainer.innerHTML = `<div class="loading">Loading...</div>`;

  const data = await fetchCategory(category);

  if (!data || !data.items?.length) {
    resultsContainer.innerHTML = `<div class="empty-state">No components found.</div>`;
    return;
  }

  renderGrid(data.items);
}

/* ------------------ Rendering Components ------------------ */
function makeCard(item) {
  const card = document.createElement("div");
  card.className = "card";

  card.innerHTML = `
    <h3>${item.component || "Unnamed"}</h3>
    <div class="platform-grid">
      <div class="label">Compose</div><div class="value">${item.compose || "—"}</div>
      <div class="label">SwiftUI</div><div class="value">${item.swiftui || "—"}</div>
      <div class="label">React Native</div><div class="value">${item.react_native || "—"}</div>
      <div class="label">Flutter</div><div class="value">${item.flutter || "—"}</div>
      <div class="label">Xamarin</div><div class="value">${item.xamarin || "—"}</div>
      <div class="label">Ionic</div><div class="value">${item.ionic || "—"}</div>
    </div>
    <div class="divider"></div>
    <div class="links-container"></div>
  `;

  const linksWrap = card.querySelector(".links-container");
  if (item.links) {
    for (let [platform, url] of Object.entries(item.links)) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.className = `link-pill ${platform}`;
      a.textContent = platform.toUpperCase();
      linksWrap.appendChild(a);
    }
  }

  return card;
}

function renderGrid(items) {
  resultsContainer.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";

  items.forEach(item => grid.appendChild(makeCard(item)));
  resultsContainer.appendChild(grid);
}

/* ------------------ Search (Debounced) ------------------ */
let searchTimer = null;

function onSearch(e) {
  const q = e.target.value.toLowerCase().trim();

  if (searchTimer) clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    if (!q) return activateTab(activeCategory, false);

    const results = SEARCH_INDEX.filter(
      item =>
        item.component?.toLowerCase().includes(q) ||
        item.compose?.toLowerCase().includes(q) ||
        item.swiftui?.toLowerCase().includes(q) ||
        item.react_native?.toLowerCase().includes(q)||
        item.xamarin?.toLowerCase().includes(q)||
        item.ionic?.toLowerCase().includes(q)
    );

    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));

    if (!results.length) {
      resultsContainer.innerHTML = `<div class="empty-state">No results for "${q}".</div>`;
      return;
    }

    renderGrid(results);
  }, 200);
}

/* ------------------ Swipe Navigation ------------------ */
let swipe = { startX: 0, startY: 0, active: false };

resultsContainer.addEventListener("touchstart", e => {
  const t = e.touches[0];
  swipe = { startX: t.clientX, startY: t.clientY, active: true };
});

resultsContainer.addEventListener("touchend", e => {
  if (!swipe.active) return;

  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.startX;
  const dy = t.clientY - swipe.startY;

  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    const index = CATEGORIES.indexOf(activeCategory);
    const next = dx < 0 ? index + 1 : index - 1;

    if (next >= 0 && next < CATEGORIES.length) {
      activateTab(CATEGORIES[next], true);
    }
  }

  swipe.active = false;
});

/* ------------------ Init ------------------ */
async function init() {
  renderTabs();
  await activateTab(CATEGORIES[0], false);
  loadAllDataInBackground();
  searchInput.addEventListener("input", onSearch);
}

/* ========================
   Card → Fullscreen Expansion
   ======================== */

const modal = document.getElementById("cardModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

function enableCardExpansion() {
    document.querySelectorAll(".card").forEach(card => {
        // allow tilt cards to also expand
        card.style.cursor = "pointer";

        card.addEventListener("click", () => {
            openCardModal(card);
        });
    });
}

function openCardModal(card) {
    const rect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);

    clone.classList.add("expanding-card");
    clone.style.position = "fixed";
    clone.style.top = rect.top + "px";
    clone.style.left = rect.left + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.margin = "0";
    clone.style.zIndex = 9999;
    clone.style.transition = "all .45s cubic-bezier(.22,.9,.22,1)";
    clone.style.transformOrigin = "center";

    document.body.appendChild(clone);

    // Force browser layout read
    requestAnimationFrame(() => {
        // animate to center of screen in large size
        clone.style.top = "50%";
        clone.style.left = "50%";
        clone.style.transform = "translate(-50%, -50%) scale(1.45)";
        clone.style.width = "650px";
        clone.style.height = "460px";
        clone.style.borderRadius = "22px";
        clone.style.boxShadow = "0 24px 80px rgba(0,0,0,0.45)";
    });

    // Open modal after animation
    setTimeout(() => {
        modal.classList.add("visible");

        // Move details into modal
        modalBody.innerHTML = card.innerHTML;

        // Remove the animated clone
        clone.remove();
    }, 420);
}

// Close handler
modalClose.addEventListener("click", () => {
    modal.classList.remove("visible");
});

/* Re-enable expansion each time grid is re-rendered */
const originalRenderGrid = renderGrid;
renderGrid = function(items) {
    originalRenderGrid(items);
    enableCardExpansion();
};


init();
