// Compatibility entry point. The versioned runtime filename prevents stale
// immutable browser caches from mixing client parts from different releases.
(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = '/js/game-runtime.js?v=7.76.6-service-scout-boots-5';
  script.async = false;
  document.head.appendChild(script);
})();
