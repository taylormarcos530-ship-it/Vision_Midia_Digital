(() => {
  'use strict';
  const source = new URLSearchParams(location.search).get('source') || 'soccer';
  const labels = {news_br:['Notícias do Brasil','g1'],soccer:['Futebol brasileiro','ge • Brasileirão'],sports_br:['Futebol brasileiro','ge • Brasileirão'],cinema_br:['Cinema e séries','CinePOP']};
  const label = labels[source] || ['Notícias',''];
  document.body.dataset.category = source;
  document.getElementById('category').textContent = label[0];
  document.getElementById('visual-category').textContent = label[0];
  document.getElementById('source').textContent = label[1];
  let items = [], index = 0, timer;
  function safePhoto(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /(?:^|\.)(?:glbimg\.com|globo\.com|cinepop\.com\.br)$/.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function show() {
    if (!items.length) return;
    const item = items[index % items.length];
    document.getElementById('title').textContent = item.title;
    document.getElementById('description').textContent = item.description || '';
    document.getElementById('counter').textContent = `${index % items.length + 1} / ${items.length}`;
    const visual = document.getElementById('visual'), photo = document.getElementById('photo');
    const url = safePhoto(item.image_url);
    visual.classList.remove('has-photo');
    photo.hidden = true;
    photo.onload = () => { if (photo.getAttribute('src') === url && photo.naturalWidth) { photo.hidden = false; visual.classList.add('has-photo'); } };
    photo.onerror = () => { photo.hidden = true; visual.classList.remove('has-photo'); };
    if (url) { photo.alt = item.title; photo.src = url; } else photo.removeAttribute('src');
    index++;
    const next = safePhoto(items[index % items.length]?.image_url);
    if (next) { const preload = new Image(); preload.src = next; }
  }
  async function load() {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const url = new URL('./api/news-feed', location.href);
      url.searchParams.set('source', source);
      url.searchParams.set('v', '2');
      const response = await fetch(url, {cache:'no-store',signal:controller.signal});
      const data = await response.json();
      if (!response.ok || !data.ok || data.schema_version !== 2 || data.language !== 'pt-BR' || data.source !== source) throw new Error('Fonte incompatível');
      const next = Array.isArray(data.items) ? data.items.filter(item => typeof item.title === 'string' && item.title) : [];
      if (!next.length) throw new Error('Sem notícias');
      items = next;
      index = 0;
      show();
      clearInterval(timer);
      timer = setInterval(show, 10000);
      document.getElementById('updated').textContent = 'Atualização automática • Português';
    } catch {
      if (!items.length) {
        document.getElementById('title').textContent = 'Aguardando notícias em português';
        document.getElementById('description').textContent = 'Fonte temporariamente indisponível. A playlist continua normalmente.';
      }
    } finally { clearTimeout(timeout); }
  }
  load();
  setInterval(load, 300000);
})();
