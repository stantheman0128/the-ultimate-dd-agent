/* Runs before styles paint. Appearance never reloads or changes case state. */
(function () {
  'use strict';
  const key = 'dd-ui-appearance';
  const normalize = value => value === 'modern' ? 'modern' : 'classic';
  let appearance = 'classic';
  try { appearance = normalize(localStorage.getItem(key)); } catch { /* Storage can be blocked. */ }
  document.documentElement.dataset.ui = appearance;
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('uiAppearance');
    if (!select) return;
    select.value = appearance;
    select.addEventListener('change', () => {
      appearance = normalize(select.value);
      select.value = appearance;
      document.documentElement.dataset.ui = appearance;
      try { localStorage.setItem(key, appearance); } catch { /* Still usable for this session. */ }
    });
    window.addEventListener('storage', event => {
      if (event.key !== key && event.key !== null) return;
      appearance = normalize(event.newValue);
      document.documentElement.dataset.ui = appearance;
      select.value = appearance;
    });
  });
})();
