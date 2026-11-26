// Loaded as a blocking script in <head> so the saved theme is applied before
// first paint and the page never flashes the wrong one. An external file
// rather than inline so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var saved = localStorage.getItem('scoresheet.theme.v1') || 'system';
    var dark = saved === 'dark' ||
      (saved === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* private mode or blocked storage: fall through to the light default */
  }
})();
