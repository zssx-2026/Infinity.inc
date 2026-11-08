/*
 * Infinity.Inc - apply the saved theme before the first paint.
 *
 * site.js is loaded at the end of the body on most pages, which is too late:
 * the browser has already painted the dark background once. This file is two
 * dozen lines and is loaded in <head>, so the attribute exists before the
 * first frame and a light-theme visitor never sees a black flash.
 *
 * The key and the value set are the same ones site.js uses (SETTINGS_KEY,
 * DEFAULT_SETTINGS.theme); if they ever drift, this file wins for the first
 * paint and site.js wins afterwards, which is why they must not drift.
 */
(function () {
  var KEY = 'infinity.settings';
  var theme = 'dark';
  try {
    var stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    if (stored.theme === 'light' || stored.theme === 'dark') theme = stored.theme;
  } catch (e) { /* a disabled store means the default, not an error */ }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
})();
