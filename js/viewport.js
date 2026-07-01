'use strict';
// Offset fixed bottom UI for iOS Safari's collapsing browser chrome.
// In standalone (home screen) mode there is no chrome — skip the adjustment.
(function () {
  const root = document.documentElement;

  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;

  function sync() {
    if (isStandalone) {
      root.style.setProperty('--vv-offset-bottom', '0px');
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--vv-offset-bottom', inset + 'px');
  }

  if (!isStandalone && window.visualViewport) {
    visualViewport.addEventListener('resize', sync);
    visualViewport.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
  }
  sync();
})();
