import { themes, difficulties } from './workshops.js';

export const themeKey = (theme) => theme.toLowerCase().replaceAll('&', 'and').replaceAll(/[^a-z0-9]+/g, '-');
const themeKeys = themes.map(themeKey);
const levels = difficulties.map((level) => level.toLowerCase());

export function readFilters(search) {
  const params = new URLSearchParams(search);
  const choose = (key, allowed) => allowed.includes(params.get(key)) ? params.get(key) : 'all';
  return {
    q: (params.get('q') || '').slice(0, 120),
    theme: choose('theme', themeKeys),
    difficulty: choose('difficulty', levels),
    mode: choose('mode', ['simulation', 'replay']),
    start: params.get('start') === '1',
  };
}

export function filterSearch(filters) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  for (const key of ['theme', 'difficulty', 'mode']) {
    if (filters[key] !== 'all') params.set(key, filters[key]);
  }
  if (filters.start) params.set('start', '1');
  return params.size ? `?${params}` : '';
}

export function matchesWorkshop(workshop, filters) {
  if (filters.theme !== 'all' && themeKey(workshop.theme) !== filters.theme) return false;
  if (filters.difficulty !== 'all' && workshop.difficulty.toLowerCase() !== filters.difficulty) return false;
  if (filters.mode === 'simulation' && workshop.mode !== 'Interactive simulation') return false;
  if (filters.mode === 'replay' && workshop.mode !== 'Recorded replay') return false;
  if (filters.start && (workshop.prerequisites.length || workshop.difficulty !== 'Beginner')) return false;
  const text = [workshop.id, workshop.title, workshop.question, workshop.summary, workshop.theme, workshop.fidelity, ...workshop.tags].join(' ').toLowerCase();
  return filters.q.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
}
