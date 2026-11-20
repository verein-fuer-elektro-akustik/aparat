// Light and dark mode. "system" (the default) follows the operating system's
// setting; light or dark is kept in this browser. The colours are CSS custom
// properties (style.css); canvases read them from `colours`, which is kept up
// to date, and onThemeChange() tells them when to redraw.
//
// index.html sets data-theme before the page is drawn, so a stored choice
// shows without a flash of the other theme.

const KEY = 'aparat.theme';
const NAMES = ['f-high', 'edge', 'cable-base', 'cable-signal', 'halo'];

export const colours = {};
const listeners = [];

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // not kept, but still applied
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  changed();
}

export const onThemeChange = (fn) => listeners.push(fn);

function changed() {
  const style = getComputedStyle(document.documentElement);
  for (const name of NAMES) colours[name] = style.getPropertyValue(`--${name}`).trim();
  for (const fn of listeners) fn();
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', changed);
changed();
