const ENGLISH_LOCALE = 'en-GB';

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat(ENGLISH_LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = isoDate
    ? new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])))
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEnglishDate(value) {
  const date = asDate(value);
  return date ? LONG_DATE_FORMATTER.format(date) : '—';
}

export function formatDrawDate(draw) {
  if (typeof draw === 'string') return formatEnglishDate(draw);
  return formatEnglishDate(draw?.draw_date_iso || draw?.draw_date);
}

export function formatEnglishNumber(value, options) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(ENGLISH_LOCALE, options) : '—';
}
