/* Vision isolated preview only — safely expose two test-only content presets. */
(() => {
  'use strict';
  function install() {
    const grid = document.querySelector('#online-media-dialog .online-source-grid');
    if (!grid) return;
    const presets = [
      {
        key:'cache', title:'Teste de cache offline (bancada)',
        description:'Painel informativo com dados demonstrativos e cache local.',
        name:'Vision QA — Cache offline', file:'informativo-demo.html'
      },
      {
        key:'visual', title:'Resultados das Loterias — layout de teste',
        description:'Visual de três cartões. Sem resultados reais até validar uma fonte.',
        name:'Vision QA — Layout de resultados', file:'resultados-vision.html'
      }
    ];
    for (const preset of presets) {
      if (grid.querySelector('[data-vision-test="' + preset.key + '"]')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'online-source-card';
      button.dataset.visionTest = preset.key;
      const title = document.createElement('strong');
      title.textContent = preset.title;
      const description = document.createElement('span');
      description.textContent = preset.description;
      button.append(title, description);
      grid.append(button);
      button.addEventListener('click', () => {
        // Preserve the original media creation flow, permissions and playlist logic.
        const existing = grid.querySelector('[data-online-preset="news_br"]');
        if (!existing) return;
        existing.click();
        const name = document.querySelector('#online-media-name');
        const url = document.querySelector('#online-media-url');
        const duration = document.querySelector('#online-media-duration');
        if (name) name.value = preset.name;
        if (url) url.value = new URL('./' + preset.file, location.href).href;
        if (duration) duration.value = '30';
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
