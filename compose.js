const JSON_FILE = 'compose_full.json';


async function fetchJson() {
try {
const resp = await fetch(JSON_FILE, {cache:'no-store'});
if (!resp.ok) throw new Error('Fetch failed');
return await resp.json();
} catch (err) {
console.warn('Could not fetch JSON file:', err);
// attempt to load embedded fallback if present
return window.__COMPOSE_EMBEDDED || null;
}
}

function makeCard(item) {
const el = document.createElement('div');
el.className = 'card';
const h3 = document.createElement('h3'); h3.textContent = item.component; el.appendChild(h3);
const meta = document.createElement('div'); meta.className = 'meta';
meta.textContent = `Compose: ${item.compose} · SwiftUI: ${item.swiftui} · RN: ${item.react_native}`;
el.appendChild(meta);


const linksWrap = document.createElement('div'); linksWrap.className = 'links';
if (item.links) {
for (const key of ['compose','swiftui','react_native','flutter','xamarin','ionic']){
if (item.links[key]){
const a = document.createElement('a'); a.href = item.links[key]; a.target='_blank'; a.rel='noopener'; a.textContent = key; linksWrap.appendChild(a);
}
}
}
el.appendChild(linksWrap);
return el;
}


function render(data) {
const results = document.getElementById('results'); results.innerHTML = '';
const categories = data.categories || {};
const catKeys = Object.keys(categories);
// populate filter
const filter = document.getElementById('categoryFilter');
filter.innerHTML = '<option value="">All categories</option>' + catKeys.map(k=>`<option value="${k}">${k}</option>`).join('');


for (const key of catKeys) {
const section = document.createElement('section'); section.className='category';
const h2 = document.createElement('h2'); h2.textContent = key; section.appendChild(h2);
const grid = document.createElement('div'); grid.className='grid';
const items = categories[key].items || [];
for (const it of items) grid.appendChild(makeCard(it));
section.appendChild(grid);
results.appendChild(section);
}


attachSearchAndFilter();
}


function attachSearchAndFilter(){
const input = document.getElementById('search');
const filter = document.getElementById('categoryFilter');
const cardsSelector = '.card';
input.addEventListener('input', ()=>{
const q = input.value.trim().toLowerCase();
document.querySelectorAll(cardsSelector).forEach(c=>{
c.style.display = c.innerText.toLowerCase().includes(q) ? '' : 'none';
});
});
filter.addEventListener('change', ()=>{
const val = filter.value;
document.querySelectorAll('section.category').forEach(sec=>{
sec.style.display = (!val || sec.querySelector('h2').textContent===val) ? '' : 'none';
});
});
}


// initialize
(async function init(){
const data = await fetchJson();
if (!data) { document.getElementById('results').innerText = 'No data available.'; return }
render(data);
})();