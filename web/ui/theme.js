// Light and dark mode. "system" (the default) follows the operating system's
// setting; light or dark is kept in this browser. The colours are CSS custom
// properties (style.css); canvases read them from `colours`, which is kept up
// to date, and onThemeChange() tells them when to redraw.
//
// index.html sets data-theme before the page is drawn, so a stored choice
// shows without a flash of the other theme.

import { kept } from './kept.js';

const NAMES = ['f-high', 'f-med', 'f-low', 'edge', 'cable-base', 'cable-signal', 'cable-gate', 'cable-pitch', 'cable-edge', 'cable-shadow', 'halo'];

export const colours = {};
const listeners = [];

export function getTheme() {
  const t = kept.get('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function setTheme(theme) {
  // applied also when it can't be kept
  if (theme === 'system') kept.remove('theme');
  else kept.set('theme', theme);
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
