const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEATMAP_WEEKS = 53;

function utcDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - offset);
  return monday;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + amount);
  return next;
}

function numberList(draw) {
  return (draw?.drawn_numbers || []).map(Number).filter((value) => Number.isFinite(value));
}

function drawSum(draw) {
  return numberList(draw).reduce((total, value) => total + value, 0);
}

export function ticketNumbers(tickets = []) {
  const unique = new Set();
  for (const ticket of tickets) {
    for (const value of ticket?.numbers || []) {
      const number = Number(value);
      if (Number.isInteger(number) && number > 0) unique.add(number);
    }
  }
  return [...unique].sort((a, b) => a - b);
}

export function ticketNumberSet(tickets = []) {
  return new Set(ticketNumbers(tickets));
}

function hitCount(draw, selected) {
  if (!selected.size) return 0;
  return numberList(draw).reduce((total, value) => (selected.has(value) ? total + 1 : total), 0);
}

function heatLevel(draw, selected) {
  if (!draw) return 0;
  if (!selected.size) return 2;
  const hits = hitCount(draw, selected);
  if (hits >= 4) return 4;
  if (hits >= 2) return 3;
  if (hits === 1) return 2;
  return 1;
}

export function buildActivity(draws = [], stats = null, tickets = []) {
  const selected = ticketNumberSet(tickets);
  const byDate = new Map();
  for (const draw of draws) {
    const date = draw?.draw_date_iso;
    if (date) byDate.set(date, draw);
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const thisMonday = mondayOf(todayUtc);
  const start = addDays(thisMonday, -7 * (HEATMAP_WEEKS - 1));
  const cells = [];
  const weeks = [];

  for (let week = 0; week < HEATMAP_WEEKS; week += 1) {
    const weekDays = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      const key = isoDay(date);
      const draw = byDate.get(key);
      const hits = hitCount(draw, selected);
      const cell = {
        date: key,
        weekday: WEEKDAY_SHORT[day],
        draw,
        hits,
        level: date > todayUtc ? -1 : heatLevel(draw, selected),
        title: draw
          ? `${key} · ${(draw.drawn_numbers || []).join(' · ')}${selected.size ? ` · ${hits} ticket hits` : ''}`
          : key
      };
      weekDays.push(cell);
      cells.push(cell);
    }
    weeks.push(weekDays);
  }

  const yearAgo = addDays(todayUtc, -364);
  const recentYear = draws.filter((draw) => {
    const date = utcDate(draw.draw_date_iso);
    return date && date >= yearAgo;
  });
  const last30 = draws.filter((draw) => {
    const date = utcDate(draw.draw_date_iso);
    return date && date >= addDays(todayUtc, -30);
  });

  const weekdayMap = WEEKDAYS.map((label, index) => ({
    label: WEEKDAY_SHORT[index],
    full: label,
    draws: 0,
    hits: 0,
    sum: 0
  }));
  for (const draw of recentYear) {
    const date = utcDate(draw.draw_date_iso);
    if (!date) continue;
    const index = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
    const row = weekdayMap[index];
    row.draws += 1;
    row.hits += hitCount(draw, selected);
    row.sum += selected.size ? hitCount(draw, selected) : drawSum(draw);
  }
  const weekday = weekdayMap.map((row) => ({
    ...row,
    secondary: row.draws ? Number((row.sum / row.draws).toFixed(1)) : 0
  }));

  const monthMap = new Map();
  for (let offset = 11; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() - offset, 1));
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, {
      key,
      label: MONTH_SHORT[cursor.getUTCMonth()],
      draws: 0,
      hits: 0,
      sum: 0
    });
  }
  for (const draw of draws) {
    const date = utcDate(draw.draw_date_iso);
    if (!date) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = monthMap.get(key);
    if (!row) continue;
    row.draws += 1;
    row.hits += hitCount(draw, selected);
    row.sum += selected.size ? hitCount(draw, selected) : drawSum(draw);
  }
  const months = [...monthMap.values()].map((row) => ({
    ...row,
    secondary: row.draws ? Number((row.sum / row.draws).toFixed(1)) : 0
  }));

  let odd = 0;
  let even = 0;
  let mixed = 0;
  for (const draw of recentYear) {
    const numbers = numberList(draw);
    const oddCount = numbers.filter((value) => value % 2 === 1).length;
    if (!numbers.length) continue;
    if (oddCount === numbers.length) odd += 1;
    else if (oddCount === 0) even += 1;
    else mixed += 1;
  }
  const mixTotal = odd + even + mixed || 1;
  const mix = [
    { key: 'mixed', label: 'Mixed', value: mixed, share: mixed / mixTotal, color: 'var(--color-chart-pink)' },
    { key: 'odd', label: 'Odd-heavy', value: odd, share: odd / mixTotal, color: 'var(--color-chart-blue)' },
    { key: 'even', label: 'Even-heavy', value: even, share: even / mixTotal, color: 'var(--color-chart-orange)' }
  ];

  const pick = numberList(draws[0]).length || 6;
  const pool = stats?.frequency?.length || 49;
  const expected = stats?.draws ? (stats.draws * pick) / pool : 0;
  const numbers = (stats?.frequency || []).slice(0, 8).map((item) => ({
    label: String(item.number),
    number: item.number,
    observed: item.count,
    expected: Number(expected.toFixed(1)),
    selected: selected.has(item.number)
  }));

  const drawDays = cells.filter((cell) => cell.draw).length;
  const hitDays = cells.filter((cell) => cell.hits > 0).length;
  let streak = 0;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    if (cells[index].level < 0) continue;
    if (cells[index].draw) streak += 1;
    else if (isoDay(addDays(todayUtc, 0)) !== cells[index].date) break;
  }
  const busiest = weekday.reduce((best, row) => (row.draws > best.draws ? row : best), weekday[0]);
  const hottest = stats?.hot?.[0];
  const overdue = stats?.overdue?.[0];

  return {
    weeks,
    cells,
    weekday,
    months,
    mix,
    numbers,
    selected: [...selected],
    metrics: [
      { label: 'Draws logged', value: stats?.draws ?? draws.length, detail: stats?.label || 'archive' },
      { label: 'Active days', value: `${drawDays}/365`, detail: 'draw days in the heatmap window' },
      { label: 'Last 30 days', value: last30.length, detail: 'official draws' },
      { label: 'Ticket hits', value: selected.size ? hitDays : '—', detail: selected.size ? `${selected.size} tracked numbers` : 'generate tickets to overlay hits' },
      { label: 'Current streak', value: streak, detail: 'consecutive recent draw days' },
      { label: 'Busiest day', value: busiest?.label || '—', detail: `${busiest?.draws || 0} draws in 12 months` },
      { label: 'Hottest number', value: hottest?.number ?? '—', detail: hottest ? `${hottest.count} appearances` : 'waiting on stats' },
      { label: 'Longest gap', value: overdue?.draws_since_seen ?? '—', detail: overdue ? `number ${overdue.number}` : 'waiting on stats' }
    ]
  };
}

export function analysisChartData(result) {
  if (!result) return { histogram: [], numbers: [] };
  const histogram = (result.histogram || []).map((item) => ({
    label: String(item.match),
    count: item.count,
    rate: item.rate || 0
  }));
  const numbers = (result.number_breakdown || []).map((row) => ({
    label: String(row.number ?? row.digit),
    count: row.count,
    signal: row.signal
  }));
  return { histogram, numbers };
}

export function modelChartData(results = []) {
  return results
    .filter((row) => row.available)
    .map((row) => ({
      label: row.label.replace('ML · ', ''),
      expected: Number(row.expected_hits_within_limit) || 0,
      observed: Number(row.exact_hits_within_limit) || 0
    }));
}

export function numberTicket(number) {
  return [{ numbers: [Number(number)] }];
}

export function rollingToMonths(points = [], expectedRate = 6 / 49) {
  return (points || []).slice(-12).map((point) => ({
    label: String(point.date || '').slice(5, 10),
    draws: Number((Number(point.rate) * 100).toFixed(2)),
    secondary: Number((expectedRate * 100).toFixed(2))
  }));
}

export function windowsToBars(windows = {}) {
  return Object.entries(windows || {}).map(([label, row]) => ({
    label,
    observed: Number(row?.observed) || 0,
    expected: Number(Number(row?.expected || 0).toFixed(1))
  }));
}

export function windowsToMix(windows = {}) {
  const colors = ['var(--color-chart-pink)', 'var(--color-chart-blue)', 'var(--color-chart-orange)'];
  const preferred = ['50', '1y', 'full'].filter((key) => windows?.[key]);
  const keys = preferred.length ? preferred : Object.keys(windows || {}).slice(0, 3);
  const rows = keys.map((key, index) => ({
    key,
    label: key === 'full' ? 'Full history' : key === '1y' ? 'Last year' : `${key}-draw`,
    value: Number(windows[key]?.observed) || 0,
    color: colors[index % colors.length]
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  return rows.map((row) => ({ ...row, share: row.value / total }));
}

export function gapToBars(recency = {}) {
  const expected = Number(recency.expected_mean_gap) || 7.17;
  return [
    { label: 'Current', observed: Number(recency.current_gap) || 0, expected },
    { label: 'Mean', observed: Number(recency.mean_gap) || 0, expected },
    { label: 'Median', observed: Number(recency.median_gap) || 0, expected },
    { label: 'Max', observed: Number(recency.max_gap) || 0, expected }
  ];
}

export function pairsToBars(relationships = []) {
  return (relationships || []).slice(0, 8).map((pair) => ({
    label: (pair.pair || []).join('-'),
    observed: Number(pair.observed) || 0,
    expected: Number(Number(pair.expected || 0).toFixed(1))
  }));
}

export function pairsToMix(relationships = []) {
  let hot = 0;
  let watch = 0;
  let rest = 0;
  for (const pair of relationships || []) {
    const q = Number(pair.adjusted_p_value);
    if (q < 0.05) hot += 1;
    else if (q < 0.2) watch += 1;
    else rest += 1;
  }
  const total = hot + watch + rest || 1;
  return [
    { key: 'sig', label: 'FDR < 5%', value: hot, share: hot / total, color: 'var(--color-chart-pink)' },
    { key: 'watch', label: 'Watch', value: watch, share: watch / total, color: 'var(--color-chart-orange)' },
    { key: 'rest', label: 'Null-like', value: rest, share: rest / total, color: 'var(--color-chart-blue)' }
  ];
}

export function rankingToBars(ranking = []) {
  const expected = Number(((6 / 49) * 100).toFixed(2));
  return (ranking || []).slice(0, 8).map((row) => ({
    label: String(row.number),
    observed: Number((Number(row.modeled_probability) * 100).toFixed(2)),
    expected
  }));
}

export function scoresToMix(scores = {}) {
  const colors = ['#7b5bea', '#00a3ff', '#e91e63', '#ffa000', '#26a641'];
  const entries = Object.entries(scores || {});
  const total = entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0) || 1;
  return entries.map(([key, value], index) => ({
    key,
    label: String(key).replaceAll('_', ' '),
    value: Number(value) || 0,
    share: (Number(value) || 0) / total,
    color: colors[index % colors.length]
  }));
}

export function periodsToMonths(periods = []) {
  return (periods || []).map((period) => ({
    label: String(period.label || '').replace('20', '').slice(0, 10),
    draws: Number((Number(period.jensen_shannon_vs_uniform) * 1000).toFixed(2)),
    secondary: Number((Number(period.psi_vs_uniform) * 100).toFixed(2))
  }));
}
