// The landing page's only behaviour: the theme button (same choice and storage
// as the app's) and the feedback link, shown once a form is configured.
import { feedbackUrl } from './config.js';

const KEY = 'scoresheet.theme.v1';
const THEMES = ['system', 'light', 'dark'];
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = {
  system: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12h2.5M20 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
};

const media = matchMedia('(prefers-color-scheme: dark)');
const btn = document.getElementById('btn-theme');
let theme = 'system';
try {
  const saved = localStorage.getItem(KEY);
  if (THEMES.includes(saved)) theme = saved;
} catch {
  /* blocked storage — stay on system */
}

function apply() {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  btn.innerHTML = ICON[theme];
  btn.setAttribute('aria-label', `Theme: ${LABEL[theme]}. Change theme`);
  btn.title = `Theme: ${LABEL[theme]}`;
}

btn.onclick = () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* applied for this visit only */
  }
  apply();
};
media.addEventListener('change', () => theme === 'system' && apply());
apply();

const fb = feedbackUrl('website');
if (fb) {
  document.getElementById('feedback-link').href = fb;
  document.getElementById('feedback').hidden = false;
}
