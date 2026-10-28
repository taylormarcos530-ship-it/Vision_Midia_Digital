/* Isolated Vision QA entry point: generic offline-cache demonstration.
 * Does not access gambling services, modify the player or deploy production code.
 */
(() => {
  'use strict';

  function installCacheBenchPreset() {
    const grid = document.querySelector('#online-media-dialog .online-source-grid');
    if (!grid || grid.querySelector('[data-vision-cache-bench]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'online-source-card';
    button.dataset.visionCacheBench = '1';
    const title = document.createElement('strong');
    title.textContent = 'Teste de cache offline (bancada)';
    const description = document.createElement('span');
    description.textContent = 'Painel informativo de testes, com dados de demonstração e cache local.';
    button.append(title, description);
    grid.append(button);

    button.addEventListener('click', () => {
      // Reuse the existing dialog, validation and save flow.
      const existing = grid.querySelector('[data-online-preset="news_br"]');
      if (!existing) return;
      existing.click();
      const name = document.querySelector('#online-media-name');
      const url = document.querySelector('#online-media-url');
      const duration = document.querySelector('#online-media-duration');
      if (name) name.value = 'Vision QA — Cache offline';
      if (url) url.value = new URL('./informativo-demo.html', location.href).href;
      if (duration) duration.value = '30';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCacheBenchPreset, { once: true });
  } else {
    installCacheBenchPreset();
  }
})();
