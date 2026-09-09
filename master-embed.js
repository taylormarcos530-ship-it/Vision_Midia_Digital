(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.get('embed') !== '1') return;

  const valid = new Set(['dashboard', 'clients', 'plans', 'audit']);
  const target = valid.has(params.get('view')) ? params.get('view') : 'dashboard';
  document.body.classList.add('master-embedded');

  function activateTarget() {
    const button = document.querySelector(`[data-master-view="${target}"]`);
    if (!button) return;
    if (!button.classList.contains('active')) button.click();
  }

  function ready() {
    activateTarget();
    setTimeout(activateTarget, 250);
    setTimeout(activateTarget, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
