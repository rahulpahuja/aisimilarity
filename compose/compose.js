/**
 * Configuration: List of all category JSON filenames (without .json extension)
 * Matches the files generated in the previous steps.
 */
const CATEGORIES = [
    'layouts', 'inputs', 'buttons', 'selectors', 'navigation', 
    'display', 'accessibility', 'state', 'storage', 'networking',
    'permissions', 'sensors', 'notifications', 'security', 'devtools',
    'utilities', 'platform', 'animations', 'dragdrop', 'text',
    'gestures', 'overlays'
];

// Global cache to store loaded data
const DATA_CACHE = {};
// Global index for search (flattens all items)
let SEARCH_INDEX = [];

const tabContainer = document.getElementById('tabs');
const resultsContainer = document.getElementById('results');
const searchInput = document.getElementById('search');

/**
 * 1. Initialize Application
 */
async function init() {
    renderTabs();
    
    // Load the first category immediately
    activateTab(CATEGORIES[0]);

    // Background: Load all other categories to build the search index
    await loadAllDataInBackground();
}

/**
 * 2. Render Tab Navigation
 */
function renderTabs() {
    tabContainer.innerHTML = '';
    
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'tab';
        btn.textContent = capitalize(cat);
        btn.dataset.category = cat;
        btn.onclick = () => activateTab(cat);
        tabContainer.appendChild(btn);
    });
}

/**
 * 3. Handle Tab Switching
 */
async function activateTab(category) {
    // UI Updates
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === category);
    });
    
    // Reset search
    searchInput.value = '';

    // Show Loading
    resultsContainer.innerHTML = '<div class="loading">Loading components...</div>';

    // Fetch Data
    const data = await fetchCategory(category);
    
    if (data && data.items) {
        renderGrid(data.items);
    } else {
        resultsContainer.innerHTML = '<div class="empty-state">No components found in this category.</div>';
    }
}

/**
 * 4. Fetching Data (with Cache)
 */
async function fetchCategory(category) {
    if (DATA_CACHE[category]) {
        return DATA_CACHE[category];
    }

    try {
        const resp = await fetch(`${category}.json`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        
        // Store in cache
        DATA_CACHE[category] = json;
        
        // Add to search index if not already there (deduplication check usually not needed here but good practice)
        return json;
    } catch (err) {
        console.error(`Failed to load ${category}.json`, err);
        return null;
    }
}

/**
 * 5. Background Loading for Search
 */
async function loadAllDataInBackground() {
    const promises = CATEGORIES.map(async (cat) => {
        const data = await fetchCategory(cat);
        if (data && data.items) {
            // Tag items with their category for search results
            const taggedItems = data.items.map(item => ({ ...item, category: cat }));
            SEARCH_INDEX.push(...taggedItems);
        }
    });
    
    await Promise.all(promises);
    console.log(`Search Index Ready: ${SEARCH_INDEX.length} components loaded.`);
    searchInput.placeholder = `Search ${SEARCH_INDEX.length} components...`;
}

/**
 * 6. Rendering Logic
 */
function renderGrid(items) {
    resultsContainer.innerHTML = '';
    
    if (!items || items.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-state">No matches found.</div>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';

        // Platform Comparison Grid
        const platformsHtml = `
            <div class="platform-grid">
                <span class="label">Compose</span> <span class="value"><b>${item.compose}</b></span>
                <span class="label">SwiftUI</span> <span class="value">${item.swiftui}</span>
                <span class="label">React Native</span> <span class="value">${item.react_native}</span>
                <span class="label">Flutter</span> <span class="value">${item.flutter}</span>
            </div>
        `;

        // Links Generator
        let linksHtml = '<div class="links-container">';
        if (item.links) {
            Object.entries(item.links).forEach(([platform, url]) => {
                linksHtml += `<a href="${url}" target="_blank" class="link-pill ${platform}">${platform}</a>`;
            });
        }
        linksHtml += '</div>';

        card.innerHTML = `
            <h3>${item.component}</h3>
            ${platformsHtml}
            <div class="divider"></div>
            ${linksHtml}
        `;
        
        grid.appendChild(card);
    });

    resultsContainer.appendChild(grid);
}

/**
 * 7. Search Functionality
 */
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    
    // If empty, show the currently active tab's data
    if (!term) {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab) activateTab(activeTab.dataset.category);
        return;
    }

    // Filter global search index
    const matches = SEARCH_INDEX.filter(item => {
        return (
            item.component.toLowerCase().includes(term) ||
            item.compose.toLowerCase().includes(term) ||
            item.swiftui.toLowerCase().includes(term) ||
            item.react_native.toLowerCase().includes(term)
        );
    });

    // Deselect tabs visually to indicate search mode
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    renderGrid(matches);
});

// Helper
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Start
init();