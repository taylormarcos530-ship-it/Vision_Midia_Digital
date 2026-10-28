/* Isolated presentational view. No lottery endpoint or sample results.
 * A separately verified source must call VisionResultadosView.render().
 */
(() => {
  'use strict';
  const rules = Object.freeze({
    'mega-sena': {count:6, max:60},
    'quina': {count:5, max:80},
    'lotofacil': {count:15, max:25}
  });
  const cards = Array.from(document.querySelectorAll('[data-game]'));
  const status = document.getElementById('data-status');

  function renderNumbers(card, values) {
    const root = card.querySelector('[data-numbers]');
    const expected = rules[card.dataset.game].count;
    const list = Array.isArray(values) ? values : Array(expected).fill(null);
    root.replaceChildren(...list.map(number => {
      const node = document.createElement('span');
      node.className = 'number' + (number == null ? ' placeholder' : '');
      node.textContent = number == null ? '—' : String(number).padStart(2, '0');
      return node;
    }));
    root.setAttribute('aria-label', values ? list.join(', ') : 'Resultado indisponível');
  }

  function validDate(raw) {
    if (typeof raw !== 'string') return false;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (!match) return false;
    const day = +match[1], month = +match[2], year = +match[3];
    if (year < 2000 || year > 2100) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function validate(game, value) {
    const rule = rules[game];
    if (!rule || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value.modalidade !== game || !Number.isSafeInteger(value.concurso) || value.concurso < 1) return false;
    if (!validDate(value.dataSorteio) || typeof value.acumulou !== 'boolean') return false;
    if (!Array.isArray(value.dezenas) || value.dezenas.length !== rule.count) return false;
    const nums = value.dezenas.map(n => {
      if (typeof n === 'number' && Number.isSafeInteger(n)) return n;
      if (typeof n === 'string' && /^\d{1,2}$/.test(n)) return Number(n);
      return NaN;
    });
    return nums.every(n => Number.isInteger(n) && n >= 1 && n <= rule.max)
      && new Set(nums).size === rule.count;
  }

  function clear() {
    for (const card of cards) {
      renderNumbers(card, null);
      card.querySelector('[data-field="contest"]').textContent = '—';
      card.querySelector('[data-field="date"]').textContent = '—';
      const accumulated = card.querySelector('[data-field="accumulated"]');
      accumulated.className = '';
      accumulated.textContent = '—';
      card.querySelector('[data-waiting]').textContent = 'Aguardando dados verificados';
    }
    status.textContent = 'LAYOUT DE HOMOLOGAÇÃO • SEM FONTE DE RESULTADOS CONFIGURADA';
  }

  function render(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const entries = Object.entries(rules);
    if (!entries.every(([game]) => validate(game, payload[game]))) return false;
    // Atomic validation: a rejected payload never partially replaces the visual.
    for (const [game] of entries) {
      const value = payload[game];
      const card = cards.find(el => el.dataset.game === game);
      renderNumbers(card, value.dezenas.map(Number));
      card.querySelector('[data-field="contest"]').textContent = String(value.concurso);
      card.querySelector('[data-field="date"]').textContent = value.dataSorteio;
      const accumulated = card.querySelector('[data-field="accumulated"]');
      accumulated.className = value.acumulou ? 'yes' : 'no';
      accumulated.textContent = value.acumulou ? 'SIM' : 'NÃO';
      card.querySelector('[data-waiting]').textContent = 'Dados carregados • origem pendente de verificação';
    }
    status.textContent = 'DADOS RECEBIDOS • ORIGEM AINDA NÃO VERIFICADA';
    return true;
  }

  clear();
  Object.defineProperty(window, 'VisionResultadosView', {
    value:Object.freeze({ render, clear, validate }),
    writable:false, configurable:false
  });
})();
