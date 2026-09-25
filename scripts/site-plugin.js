import { workshops } from '../src/site/workshops.js';
import { renderCatalog } from '../src/site/catalog-template.js';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const siteUrl = (path, base) => `${base}${path.replace(/^\//, '')}`;

function prefixPageLinks(html, base) {
  // Vite resolves asset URLs itself; ordinary anchor destinations need the same base.
  // Apply this before inserting generated navigation, whose links already use base.
  return html.replace(/(<a\b[^>]*\bhref=)(["'])(\/(?!\/)[^"']*)\2/g,
    (_, prefix, quote, path) => `${prefix}${quote}${siteUrl(path, base)}${quote}`);
}

function renderHeader(path, base) {
  const inCatalog = /\/workshops(?:\/|$)/.test(path);
  return `<header class="argos-header">
    <a class="argos-brand" href="${siteUrl('/', base)}" aria-label="ARGOS Swarm Lab home">
      <svg class="argos-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 29 26H3Z M16 3v15M3 26l13-8 13 8"/><circle cx="16" cy="3" r="2"/><circle cx="3" cy="26" r="2"/><circle cx="29" cy="26" r="2"/><circle cx="16" cy="18" r="2"/></svg>
      <span>ARGOS <small>SWARM LAB</small></span>
    </a>
    <button class="argos-menu-toggle" type="button" aria-expanded="false" aria-controls="argos-primary-nav">Menu <span aria-hidden="true">+</span></button>
    <nav id="argos-primary-nav" class="argos-primary-nav" aria-label="Main navigation">
      <a href="${siteUrl('/workshops/', base)}"${inCatalog ? ' aria-current="page"' : ''}>Workshops</a>
      <a href="${siteUrl('/workshops/?start=1', base)}">Start here <span aria-hidden="true">↗</span></a>
      <a href="${siteUrl('/#about', base)}">About</a>
    </nav>
    <span class="argos-header-caption">LEARN / EXPERIMENT / UNDERSTAND</span>
  </header>`;
}

function renderWorkshopNavigation(workshop, base) {
  const index = workshops.indexOf(workshop);
  const previous = workshops[index - 1];
  const next = workshops[index + 1];
  const mode = escapeHtml(workshop.mode);
  const options = workshops.map((entry) => `<option value="${escapeHtml(siteUrl(entry.url, base))}"${entry === workshop ? ' selected' : ''}>${escapeHtml(entry.id)} / ${escapeHtml(entry.title)}</option>`).join('\n');
  return `<nav class="argos-workshop-nav" aria-label="Workshops">
    <div class="argos-workshop-current"><span class="argos-workshop-number">${escapeHtml(workshop.id)}</span><div><span class="argos-workshop-mode">${mode}</span><strong>${escapeHtml(workshop.title)}</strong></div></div>
    <div class="argos-workshop-jump"><label for="argos-workshop-select">Choose a workshop</label><select id="argos-workshop-select" aria-describedby="argos-workshop-reset">${options}</select></div>
    <div class="argos-workshop-links">${previous ? `<a href="${escapeHtml(siteUrl(previous.url, base))}" rel="prev" aria-label="Previous workshop: ${escapeHtml(previous.title)}">← Previous</a>` : ''}<a href="${siteUrl('/workshops/', base)}">All workshops</a>${next ? `<a href="${escapeHtml(siteUrl(next.url, base))}" rel="next" aria-label="Next workshop: ${escapeHtml(next.title)}">Next →</a>` : ''}</div>
    <p id="argos-workshop-reset" class="argos-workshop-reset">Switching workshops starts a fresh experiment or replay.</p>
  </nav>`;
}

function renderFooter(base) {
  return `<footer class="argos-footer"><a class="argos-footer-brand" href="${siteUrl('/', base)}">ARGOS <span>/ SWARM LAB</span></a><p>Explore collective behavior. Understand its limits.</p><a href="${siteUrl('/workshops/', base)}">Explore the workshops <span aria-hidden="true">↗</span></a></footer>`;
}

/** Render shared navigation into static HTML so every route works without JavaScript. */
export function sitePlugin() {
  let base = '/';
  return {
    name: 'argos-site-shell',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!html.includes('<!-- argos:header -->')) return html;
        const id = html.match(/\bdata-workshop=["'](\d+)["']/)?.[1];
        const workshop = id ? workshops.find((entry) => String(entry.id).padStart(2, '0') === id) : null;
        if (id && !workshop) throw new Error(`Unknown workshop ${id} in ${context.path}`);
        const output = prefixPageLinks(html, base)
          .replace('<!-- argos:header -->', renderHeader(context.path, base))
          .replace('<!-- argos:workshop-nav -->', workshop ? renderWorkshopNavigation(workshop, base) : '')
          .replace('<!-- argos:footer -->', renderFooter(base))
          .replace('<!-- argos:catalog -->', () => renderCatalog(base));
        return {
          html: output,
          tags: [
            { tag: 'link', attrs: { rel: 'stylesheet', href: '/src/site/shell.css' }, injectTo: 'head' },
            { tag: 'script', attrs: { type: 'module', src: '/src/site/navigation.js' }, injectTo: 'body' },
          ],
        };
      },
    },
  };
}
