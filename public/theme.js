// Applies a saved light/dark choice before first paint so the page never flashes the wrong theme.
try {
  var theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {}
