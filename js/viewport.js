'use strict';
(function () {
  const root = document.documentElement;

  function sync() {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--vv-offset-bottom', inset + 'px');
  }

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', sync);
    visualViewport.addEventListener('scroll', sync);
  }
  window.addEventListener('resize', sync);
  sync();
})();
