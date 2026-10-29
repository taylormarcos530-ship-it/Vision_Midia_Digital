// Pure date-only helpers. Date fields are calendar days, not UTC instants.
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function calendarDayMillis(value) {
  if (!datePattern.test(String(value))) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const millis = Date.UTC(year, month - 1, day, 12);
  const parsed = new Date(millis);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day) return null;
  return millis;
}
export function saoPauloDate(today = new Date()) {
  const components = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(today);
  const part = key => components.find(item => item.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function commercialDaysUntil(endDate, today = saoPauloDate()) {
  const endTime = calendarDayMillis(endDate);
  const todayTime = calendarDayMillis(today);
  if (endTime === null || todayTime === null) return null;
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
