// Menu bar: click a title to open its menu, then hovering other titles
// switches menus. A click on an item runs it and closes the menu, unless the
// item has data-keep (zoom steps, the two-click delete). Esc or a click
// outside closes. Arrow keys move between items and menus.

export function menubar(nav, { onOpen } = {}) {
  const menus = [...nav.querySelectorAll('.menu')].map((el) => ({
    el,
    name: el.dataset.menu,
    title: el.querySelector('.menu-title'),
    items: el.querySelector('.menu-items'),
  }));
  let open = null;

  const focusable = (m) =>
    [...m.items.querySelectorAll('button, select, input')].filter((e) => !e.disabled && e.offsetParent);

  function hide() {
    if (!open) return;
    open.items.hidden = true;
    open.title.setAttribute('aria-expanded', 'false');
    open.el.classList.remove('open');
    open = null;
  }

  function show(m, focusFirst = false) {
    if (open === m) return;
    hide();
    open = m;
    onOpen?.(m.name);
    m.items.hidden = false;
    m.title.setAttribute('aria-expanded', 'true');
    m.el.classList.add('open');
    if (focusFirst) focusable(m)[0]?.focus();
  }

  const visible = () => menus.filter((m) => !m.el.hidden);

  for (const m of menus) {
    m.title.addEventListener('click', () => (open === m ? hide() : show(m)));
    m.title.addEventListener('pointerenter', () => {
      if (open && open !== m) show(m);
    });
    m.title.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        show(m, true);
      }
    });
    m.items.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.disabled && !b.hasAttribute('data-keep')) hide();
    });
    m.items.addEventListener('keydown', (e) => {
      const list = focusable(m);
      const i = list.indexOf(document.activeElement);
      const inField = ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
      if (e.key === 'ArrowDown' && !inField) list[(i + 1) % list.length]?.focus();
      else if (e.key === 'ArrowUp' && !inField) list[(i - 1 + list.length) % list.length]?.focus();
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !inField) {
        const v = visible();
        const next = v[(v.indexOf(m) + (e.key === 'ArrowRight' ? 1 : v.length - 1)) % v.length];
        show(next, true);
      } else if (e.key === 'Escape') {
        hide();
        m.title.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  window.addEventListener('pointerdown', (e) => {
    if (open && !open.el.contains(e.target)) hide();
  }, true);

  return {
    hide,
    get open() {
      return open?.name ?? null;
    },
  };
}
