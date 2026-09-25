import { workshops } from './workshops.js';
import { readFilters, filterSearch, matchesWorkshop } from './catalog-state.js';

const form = document.querySelector('#catalog-filters');
const count = document.querySelector('#catalog-count');
const active = document.querySelector('#catalog-active');
const empty = document.querySelector('#catalog-empty');
const entries = new Map([...document.querySelectorAll('[data-workshop-id]')].map((entry) => [entry.dataset.workshopId, entry]));
let filters = readFilters(location.search);
let searchSession = false;

function render() {
  for (const key of ['q', 'theme', 'difficulty', 'mode']) form.elements[key].value = filters[key];
  form.elements.start.checked = filters.start;
  let visible = 0;
  for (const workshop of workshops) {
    const match = matchesWorkshop(workshop, filters);
    entries.get(workshop.id).hidden = !match;
    if (match) visible += 1;
  }
  count.textContent = `${visible} of ${workshops.length} workshops`;
  empty.hidden = visible !== 0;
  const labels = ['theme', 'difficulty', 'mode'].filter((key) => filters[key] !== 'all')
    .map((key) => form.elements[key].selectedOptions[0].textContent);
  if (filters.start) labels.push('Beginner workshops without workshop prerequisites');
  if (filters.q.trim()) labels.push(`“${filters.q.trim()}”`);
  active.textContent = labels.join(' / ');
}

function update(replace = false) {
  const query = filterSearch(filters);
  const url = location.pathname + query + location.hash;
  if (url !== location.pathname + location.search + location.hash) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  render();
}

form.elements.q.addEventListener('input', () => {
  filters.q = form.elements.q.value;
  update(searchSession);
  searchSession = true;
});
form.elements.q.addEventListener('blur', () => { searchSession = false; });
for (const key of ['theme', 'difficulty', 'mode', 'start']) {
  form.elements[key].addEventListener('change', () => {
    filters[key] = key === 'start' ? form.elements.start.checked : form.elements[key].value;
    searchSession = false;
    update();
  });
}
form.addEventListener('submit', (event) => { event.preventDefault(); update(); });
document.querySelector('#catalog-clear').addEventListener('click', () => {
  filters = readFilters('');
  searchSession = false;
  update();
});
window.addEventListener('popstate', () => {
  filters = readFilters(location.search);
  searchSession = false;
  render();
});
form.hidden = false;
render();
