(() => {
  'use strict';
  function install() {
    const grid = document.querySelector('#online-media-dialog .online-source-grid');
    if (!grid || grid.querySelector('[data-online-preset="lottery"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'online-source-card';
    button.dataset.onlinePreset = 'lottery';
    button.innerHTML = '<strong>Lotérica — Mega-Sena</strong><span>Último resultado publicado, atualizado automaticamente.</span>';
    grid.append(button);
    button.addEventListener('click', () => {
      const existing = grid.querySelector('[data-online-preset="news_br"]');
      if (!existing) return;
      existing.click();
      const name = document.querySelector('#online-media-name');
      const url = document.querySelector('#online-media-url');
      const duration = document.querySelector('#online-media-duration');
      if (name) name.value = 'Lotérica — Mega-Sena';
      if (url) url.value = new URL('./lottery-result.html', location.href).href;
      if (duration) duration.value = '30';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();