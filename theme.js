/* ============================================================
   THEME.JS
   System / Light / Dark. Loaded in <head> so the theme is set before
   the first paint (no flash of the wrong theme). Only design tokens
   change per theme — see :root[data-theme="light"] in style.css.

   "System" follows the device setting live: if the phone flips to dark
   at sunset, Together follows without a reload.
   ============================================================ */
(function(){
  const KEY = 'together_theme';
  const PREFS = ['system', 'light', 'dark'];
  const BAR_COLOR = { light:'#f3f7fd', dark:'#0b0f1a' };     // browser/status-bar tint
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  let memoryPref = null;                                       // used if localStorage is blocked

  function readPref(){
    try{ const v = localStorage.getItem(KEY); if (PREFS.includes(v)) return v; }catch(e){}
    return memoryPref || 'system';
  }
  function resolve(pref){
    if (pref === 'system') return (media && media.matches) ? 'light' : 'dark';
    return pref;
  }
  function apply(){
    const pref = readPref();
    const theme = resolve(pref);
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = BAR_COLOR[theme];
    document.querySelectorAll('.theme-choice').forEach(btn=>{
      const on = btn.dataset.themePref === pref;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('selected', on);
    });
  }
  window.setThemePreference = function(pref){
    if (!PREFS.includes(pref)) return;
    memoryPref = pref;
    try{ localStorage.setItem(KEY, pref); }catch(e){}
    apply();
  };

  apply();
  if (media){
    if (media.addEventListener) media.addEventListener('change', apply);
    else if (media.addListener) media.addListener(apply);       // older Safari
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('.theme-choice').forEach(btn=>{
      btn.addEventListener('click', ()=> window.setThemePreference(btn.dataset.themePref));
    });
    apply();
  });
})();
