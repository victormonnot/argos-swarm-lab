const menuButton = document.querySelector('.argos-menu-toggle');
const menu = document.querySelector('.argos-primary-nav');

if (menuButton && menu) {
  const closeMenu = () => {
    menuButton.setAttribute('aria-expanded', 'false');
    menu.removeAttribute('data-open');
  };
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menu.toggleAttribute('data-open', open);
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });
  window.matchMedia('(max-width: 640px)').addEventListener('change', closeMenu);
}

const workshopSelect = document.querySelector('#argos-workshop-select');
workshopSelect?.addEventListener('change', () => {
  if (workshopSelect.value) window.location.assign(workshopSelect.value);
});

// The unenhanced page keeps all primary links and the workshop previous/next links visible.
document.body.classList.add('argos-nav-ready');
