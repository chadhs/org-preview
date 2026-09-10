const storageKeys = {
  mode: 'org-preview-theme',
  light: 'org-preview-light-theme',
  dark: 'org-preview-dark-theme',
  sansSerifHeadings: 'org-preview-sans-serif-headings',
};

export function normalizePreferences(preferences = {}) {
  return {
    mode: ['system', 'light', 'dark'].includes(preferences.mode) ? preferences.mode : 'system',
    light: ['light', 'solarized-light'].includes(preferences.light) ? preferences.light : 'light',
    dark: ['dark', 'solarized-dark'].includes(preferences.dark) ? preferences.dark : 'dark',
    sansSerifHeadings: preferences.sansSerifHeadings === true || preferences.sansSerifHeadings === 'true',
  };
}

export function readPreferences(storage) {
  return normalizePreferences(Object.fromEntries(Object.entries(storageKeys).map(([name, key]) => [name, storage.getItem(key)])));
}

export function savePreferences(storage, preferences) {
  const normalized = normalizePreferences(preferences);
  for (const [name, key] of Object.entries(storageKeys)) storage.setItem(key, String(normalized[name]));
}

export function resolveTheme(preferences, systemDark) {
  const normalized = normalizePreferences(preferences);
  const mode = normalized.mode === 'system' ? (systemDark ? 'dark' : 'light') : normalized.mode;
  return { theme: normalized[mode], colorScheme: mode };
}

export function initializeAppearance() {
  const button = document.querySelector('#appearance-button');
  const panel = document.querySelector('#appearance-panel');
  const controls = {
    mode: document.querySelector('#appearance-mode'),
    light: document.querySelector('#light-theme'),
    dark: document.querySelector('#dark-theme'),
    sansSerifHeadings: document.querySelector('#sans-serif-headings'),
  };
  const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
  let preferences = readPreferences(localStorage);
  function apply() {
    const { theme, colorScheme } = resolveTheme(preferences, systemAppearance.matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = colorScheme;
    document.documentElement.dataset.headingFont = preferences.sansSerifHeadings ? 'sans-serif' : 'default';
    void window.orgPreview.windowTheme(theme).catch(() => {});
  }
  for (const [name, control] of Object.entries(controls)) {
    if (control.type === 'checkbox') control.checked = preferences[name];
    else control.value = preferences[name];
    control.addEventListener('change', () => {
      preferences = normalizePreferences({ ...preferences, [name]: control.type === 'checkbox' ? control.checked : control.value });
      savePreferences(localStorage, preferences);
      apply();
    });
  }
  systemAppearance.addEventListener('change', apply);
  apply();

  function positionPanel() {
    const anchor = button.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`;
    panel.style.top = `${anchor.bottom + 8}px`;
  }
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open');
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      positionPanel();
      controls.mode.focus();
    }
  });
  window.addEventListener('resize', () => { if (panel.matches(':popover-open')) positionPanel(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panel.matches(':popover-open')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    panel.hidePopover();
    button.focus();
  }, { capture: true });
}
