// Pure date-only helpers. Date fields are calendar days, not UTC instants.
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function saoPauloDate(today = new Date()) {
  const components = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(today);
  const part = key => components.find(item => item.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function commercialDaysUntil(endDate, today = saoPauloDate()) {
  if (!datePattern.test(String(endDate)) || !datePattern.test(String(today))) return null;
  const endTime = Date.parse(endDate + 'T12:00:00Z');
  const todayTime = Date.parse(today + 'T12:00:00Z');
  if (!Number.isFinite(endTime) || !Number.isFinite(todayTime)) return null;
  return Math.round((endTime - todayTime) / 86400000);
}
export function commercialDeadlineLabel(endDate, today = saoPauloDate()) {
  const days = commercialDaysUntil(endDate, today);
  if (days == null) return { label: 'Prazo não informado', state: 'unknown', days: null };
  if (days === 0) return { label: 'Vence hoje', state: 'today', days: 0 };
  if (days > 0) return {
    label: days === 1 ? 'Falta 1 dia' : `Faltam ${days} dias`,
    state: 'upcoming', days,
  };
  const overdue = Math.abs(days);
  return {
    label: overdue === 1 ? 'Vencida há 1 dia' : `Vencida há ${overdue} dias`,
    state: 'expired', days,
  };
}
