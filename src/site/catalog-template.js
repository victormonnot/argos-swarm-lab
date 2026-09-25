import { workshops, themes, difficulties } from './workshops.js';

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const slug = (value) => value.toLowerCase().replaceAll('&', 'and').replaceAll(/[^a-z0-9]+/g, '-');
const urlAt = (base, url) => `${base.replace(/\/$/, '')}${url}`;

function preparation(workshop, base) {
  const required = workshop.prerequisites.map((id) => {
    const item = workshops.find((candidate) => candidate.id === id);
    return `<a href="${escape(urlAt(base, item.url))}">${item.id} / ${escape(item.title)}</a>`;
  });
  if (workshop.preparation) required.push(escape(workshop.preparation));
  const helpful = workshop.helpfulBefore.map((id) => {
    const item = workshops.find((candidate) => candidate.id === id);
    return `<a href="${escape(urlAt(base, item.url))}">${item.id} / ${escape(item.title)}</a>`;
  });
  return `<p><strong>Recommended preparation:</strong> ${required.join('; ') || 'None. You can start here.'}</p>
    ${helpful.length ? `<p><strong>Also helpful:</strong> ${helpful.join('; ')}</p>` : ''}`;
}

// Vite uses this at development/build time. All workshop links work without JS.
export function renderCatalog(base = '/') {
  return `<form class="catalog-filters" id="catalog-filters" role="search" aria-label="Find a workshop" hidden>
    <label class="catalog-search" for="catalog-query">Search<input id="catalog-query" name="q" type="search" maxlength="120" placeholder="Try consensus, mapping or ROS 2" autocomplete="off" /></label>
    <label for="catalog-theme">Theme<select id="catalog-theme" name="theme"><option value="all">All themes</option>${themes.map((theme) => `<option value="${slug(theme)}">${escape(theme)}</option>`).join('')}</select></label>
    <label for="catalog-difficulty">Difficulty<select id="catalog-difficulty" name="difficulty"><option value="all">All levels</option>${difficulties.map((level) => `<option value="${level.toLowerCase()}">${escape(level)}</option>`).join('')}</select></label>
    <label for="catalog-mode">Execution mode<select id="catalog-mode" name="mode"><option value="all">All modes</option><option value="simulation">Interactive simulation</option><option value="replay">Recorded replay</option></select></label>
    <label class="catalog-start"><input type="checkbox" name="start" id="catalog-start" value="1" /> Start here: beginner workshops</label>
    <button class="catalog-clear" type="button" id="catalog-clear">Clear filters</button>
  </form>
  <noscript><p class="catalog-note">All 23 workshops are listed below. Filtering requires JavaScript; the links and preparation details remain available.</p></noscript>
  <div class="catalog-status"><p id="catalog-count" class="site-mono" role="status" aria-live="polite">23 workshops</p><p id="catalog-active" class="catalog-active"></p></div>
  <p class="catalog-empty" id="catalog-empty" hidden>No workshops match these filters. Try another term or clear the filters.</p>
  <div class="workshop-list">${workshops.map((workshop) => `<article class="workshop-entry" data-workshop-id="${workshop.id}">
    <div class="workshop-row"><span class="workshop-id">${workshop.id}</span><div class="workshop-description"><p class="workshop-theme">${escape(workshop.theme)}</p><h2><a href="${escape(urlAt(base, workshop.url))}">${escape(workshop.title)} <span aria-hidden="true">↗</span></a></h2><p>${escape(workshop.question)}</p></div><span class="workshop-difficulty">${escape(workshop.difficulty)}</span><span class="workshop-mode"><span class="mode-shape ${workshop.mode === 'Recorded replay' ? 'replay' : 'simulation'}" aria-hidden="true"></span>${escape(workshop.mode)}</span></div>
    <details class="workshop-preparation"><summary>Preparation and limits<span class="sr-only"> for ${escape(workshop.title)}</span></summary><div>${preparation(workshop, base)}<p>${escape(workshop.summary)}</p><p><strong>What this represents:</strong> ${escape(workshop.fidelity)}</p><p><strong>Limits:</strong> ${escape(workshop.limitations)}</p></div></details>
  </article>`).join('')}</div>`;
}
