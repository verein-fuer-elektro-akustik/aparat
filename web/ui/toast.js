// Messages stack at the top right. Each closes on click or after a while; the
// same message again restarts its timer instead of stacking up.

const TOAST_MS = 8000;
const MAX_TOASTS = 4;
const root = document.getElementById('error');

function show(text, className) {
  let toast = [...root.children].find((t) => t.textContent === text);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = className;
    toast.textContent = text;
    toast.title = 'click to close';
    toast.addEventListener('click', () => toast.remove());
    root.append(toast);
    while (root.children.length > MAX_TOASTS) root.firstElementChild.remove();
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.remove(), TOAST_MS);
}

export function showError(err) {
  if (err) show(String(err.message ?? err), 'toast');
}

// something worth knowing that is not a problem
export function showInfo(text) {
  show(text, 'toast info');
}

// keep messages just below the toolbar, which wraps on narrow windows
new ResizeObserver(() => {
  root.style.top = `${document.querySelector('header').getBoundingClientRect().bottom + 8}px`;
}).observe(document.querySelector('header'));
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

export const guarded = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    showError(err);
  }
};

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
