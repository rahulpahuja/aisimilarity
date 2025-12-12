/**
 * compose.js — FINAL WORKING VERSION
 * - Neon + Glass UI
 * - Search + category tabs
 * - Swipe navigation
 * - Light/dark theme toggle
 * - Card tilt + fullscreen expansion modal
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

/* ------------------ THEME SYSTEM ------------------ */
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
      SEARCH_INDEX.push(...data.items.map(item => ({ ...item, __category: cat })));
    }
    await sleep(50);
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

  CATEGORIES.forEach((cat, idx) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.dataset.category = cat;
    tab.dataset.index = idx;
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
}

/* ------------------ Activate a Tab ------------------ */
async function activateTab(category, userTriggered = false) {
  activeCategory = category;

  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.category === category)
  );

  moveIndicatorToTab(tabContainer.querySelector(`[data-category="${category}"]`));

  if (userTriggered) searchInput.value = "";

  resultsContainer.innerHTML = `<div class="loading">Loading…</div>`;

  const data = await fetchCategory(category);

  if (!data || !data.items?.length) {
    resultsContainer.innerHTML = `<div class="empty-state">No components found.</div>`;
    return;
  }

  renderGrid(data.items);
}

/* ------------------ Render Cards ------------------ */
function makeCard(item) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.expand = "true";

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

  // enable modal open
  card.addEventListener("click", () => openCardModal(card));

  return card;
}

function renderGrid(items) {
  resultsContainer.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";

  items.forEach(it => grid.appendChild(makeCard(it)));

  resultsContainer.appendChild(grid);
}

/* ------------------ Search ------------------ */
let searchTimer = null;

function onSearch(e) {
  const q = e.target.value.toLowerCase().trim();

  if (searchTimer) clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    if (!q) return activateTab(activeCategory, false);

    const matches = SEARCH_INDEX.filter(item =>
      (item.component || "").toLowerCase().includes(q) ||
      (item.compose || "").toLowerCase().includes(q) ||
      (item.swiftui || "").toLowerCase().includes(q) ||
      (item.react_native || "").toLowerCase().includes(q) ||
      (item.xamarin || "").toLowerCase().includes(q) ||
      (item.ionic || "").toLowerCase().includes(q)
    );

    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));

    if (!matches.length) {
      resultsContainer.innerHTML = `<div class="empty-state">No results.</div>`;
      return;
    }

    renderGrid(matches);
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

  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
    const idx = CATEGORIES.indexOf(activeCategory);
    const next = dx < 0 ? idx + 1 : idx - 1;

    if (next >= 0 && next < CATEGORIES.length) {
      activateTab(CATEGORIES[next], true);
    }
  }

  swipe.active = false;
});

/* ------------------ FULLSCREEN CARD MODAL ------------------ */
const modal = document.getElementById("cardModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

function openCardModal(card) {
  modalBody.innerHTML = card.innerHTML;
  modal.classList.add("visible");
}

modalClose.addEventListener("click", () => {
  modal.classList.remove("visible");
});

/* ------------------ Init ------------------ */
async function init() {
  renderTabs();
  await activateTab(CATEGORIES[0], false);
  loadAllDataInBackground();
  searchInput.addEventListener("input", onSearch);
}

init();
