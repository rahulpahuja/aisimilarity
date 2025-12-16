// Theme initializer — applies SiteConfig.defaultTheme early to avoid FOUC
(function(){
  try {
    var cfg = window.SiteConfig || { defaultTheme: 'dark' };
    var theme = cfg.defaultTheme || 'dark';
    var apply = function(){
      if(theme === 'dark'){
        document.documentElement.classList.add('dark-mode');
        document.documentElement.classList.remove('theme-light');
        document.documentElement.setAttribute('data-theme','dark');
        if(document.body) {
          document.body.classList.add('dark-mode');
          document.body.setAttribute('data-theme','dark');
        }
      } else {
        document.documentElement.classList.add('theme-light');
        document.documentElement.classList.remove('dark-mode');
        document.documentElement.setAttribute('data-theme','light');
        if(document.body) {
          document.body.classList.add('theme-light');
          document.body.setAttribute('data-theme','light');
        }
      }
    };
    // run immediately (runs before CSS if included in head)
    apply();
    // ensure it applies once body exists
    if(!document.body){
      document.addEventListener('DOMContentLoaded', apply);
    }
  } catch(e) {
    console.error('theme-init error', e);
  }
})();
