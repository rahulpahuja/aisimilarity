/* theme.js — load synchronously in <head> (no defer) to avoid a flash of the wrong theme.
   Resolution order: saved choice (localStorage 'ais-theme') -> legacy 'dark-mode' key
   -> SiteConfig.defaultTheme -> 'dark'. Storage access is wrapped: it can throw in private modes. */
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('ais-theme');
    if (!theme) {
      var legacy = localStorage.getItem('dark-mode');
      if (legacy === 'enabled') theme = 'dark';
      else if (legacy === 'disabled') theme = 'light';
    }
  } catch (e) { /* storage unavailable */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = (window.SiteConfig && window.SiteConfig.defaultTheme) || 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
