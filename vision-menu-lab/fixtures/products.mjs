/** Demonstration only: fictitious prices, not an offer from Casa de Carnes Bom Sabor. */
export const SAMPLE_PRODUCTS = Object.freeze([
  ['Picanha', 78.90], ['Contra-filé', 49.90], ['Alcatra', 45.90],
  ['Coxão mole', 39.90], ['Patinho', 37.90], ['Fraldinha', 42.90],
  ['Linguiça toscana', 24.90], ['Peito de frango', 18.90],
  ['Costela bovina', 32.90], ['Acém', 29.90], ['Músculo', 25.90],
  ['Cupim', 41.90], ['Pernil suíno', 22.90], ['Bisteca suína', 21.90],
  ['Asa de frango', 19.90], ['Filé de tilápia', 48.90],
  ['Coração de frango', 35.90], ['Linguiça de frango', 23.90],
].map(([name, price], index) => Object.freeze({
  id: `sample-${String(index + 1).padStart(2, '0')}`,
  name,
  priceCents: Math.round(price * 100),
  enabled: true,
})));
