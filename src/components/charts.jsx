import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { buildActivity } from '../lib/activity';
import { MetricCard } from './ui';
import { TicketStack } from './lottery/CompactTicket';

const CHART = {
  blue: '#00a3ff',
  purple: '#7b5bea',
  pink: '#e91e63',
  orange: '#ffa000',
  grid: 'var(--color-line)',
  tick: 'var(--color-muted)',
  ink: 'var(--color-ink)'
};

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const CHART_MARGIN = { top: 18, right: 8, left: 0, bottom: 4 };

function ChartTip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <output className="chart-tip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey}>
          {entry.name}: {entry.value}{suffix}
        </span>
      ))}
    </output>
  );
}

export function ActivityHeatmap({ weeks = [] }) {
  return (
    <ol className="heatmap" style={{ '--weeks': weeks.length }} aria-label="Draw activity heatmap">
      {DAY_LABELS.map((label, index) => (
        <li key={`dow-${index}`} className="heatmap-dow">{label}</li>
      ))}
      {weeks.flat().map((cell) => (
        <li
          key={cell.date}
          className={`heat heat-${cell.level}`}
          title={cell.title}
        />
      ))}
    </ol>
  );
}

export { MetricCard, MetricGrid } from './ui';

export function WeekdayChart({ data = [], hitMode = false, leftName = 'Draws', rightName }) {
  const right = rightName || (hitMode ? 'Avg hits' : 'Avg sum');
  return (
    <BarChart className="chart-frame" style={{ width: '100%', height: 320 }} responsive data={data} barGap={4} barCategoryGap="28%" margin={CHART_MARGIN}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
      <Tooltip content={<ChartTip />} cursor={{ fill: 'transparent' }} />
      <Bar dataKey="draws" name={leftName} fill={CHART.purple} radius={[6, 6, 0, 0]} maxBarSize={18}>
        <LabelList dataKey="draws" position="top" fill="currentColor" fontSize={10} />
      </Bar>
      <Bar dataKey="secondary" name={right} fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={18}>
        <LabelList dataKey="secondary" position="top" fill="currentColor" fontSize={10} />
      </Bar>
    </BarChart>
  );
}

export function MonthTrendChart({ data = [], hitMode = false, leftName = 'Draws', rightName }) {
  const right = rightName || (hitMode ? 'Ticket hits' : 'Avg sum');
  return (
    <LineChart className="chart-frame" style={{ width: '100%', height: 240 }} responsive data={data} margin={CHART_MARGIN}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
      <Tooltip content={<ChartTip />} />
      <Legend />
      <Line type="monotone" dataKey="draws" name={leftName} stroke={CHART.purple} strokeWidth={2.5} dot={{ r: 3 }} />
      <Line type="monotone" dataKey="secondary" name={right} stroke={CHART.blue} strokeWidth={2} strokeDasharray="6 6" dot={false} />
    </LineChart>
  );
}

export function MixDonut({ data = [], total = 0, caption = 'draws' }) {
  return (
    <section className="donut">
      <PieChart className="chart-frame" style={{ width: '100%', height: 240 }} responsive>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
          {data.map((slice) => <Cell key={slice.key} fill={slice.color} />)}
        </Pie>
        <Tooltip content={<ChartTip />} />
      </PieChart>
      <p className="donut-center">
        <strong>{total.toLocaleString()}</strong>
        <span>{caption}</span>
      </p>
    </section>
  );
}

export function NumberBars({ data = [] }) {
  return (
    <BarChart className="chart-frame" style={{ width: '100%', height: 240 }} responsive data={data} barGap={3} barCategoryGap="22%" margin={CHART_MARGIN}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
      <Tooltip content={<ChartTip />} />
      <Bar dataKey="expected" name="Expected" fill={CHART.purple} radius={[6, 6, 0, 0]} maxBarSize={16} />
      <Bar dataKey="observed" name="Observed" fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={16}>
        <LabelList dataKey="observed" position="top" fill="currentColor" fontSize={10} />
      </Bar>
    </BarChart>
  );
}

export function HistogramChart({ data = [] }) {
  if (!data.length) return null;
  return (
    <BarChart className="chart-frame" style={{ width: '100%', height: 240 }} responsive data={data} margin={CHART_MARGIN}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
      <Tooltip content={<ChartTip />} />
      <Bar dataKey="count" name="Draws" fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={28} />
    </BarChart>
  );
}

export function ModelCompareChart({ data = [] }) {
  if (!data.length) return null;
  return (
    <BarChart className="chart-frame chart-frame--tall" style={{ width: '100%', height: 300 }} responsive data={data} barGap={4} margin={{ top: 18, right: 8, left: 0, bottom: 28 }}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 10 }} interval={0} angle={-28} textAnchor="end" height={70} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
      <Tooltip content={<ChartTip />} />
      <Bar dataKey="expected" name="Expected" fill={CHART.purple} radius={[6, 6, 0, 0]} maxBarSize={18} />
      <Bar dataKey="observed" name="Observed" fill={CHART.blue} radius={[6, 6, 0, 0]} maxBarSize={18} />
    </BarChart>
  );
}

export function RollingLineChart({ points = [] }) {
  if (!points.length) return null;
  const data = points.map((point) => ({
    label: String(point.date || '').slice(0, 7),
    rate: Number((Number(point.rate) * 100).toFixed(2)),
    expected: Number(((6 / 49) * 100).toFixed(2))
  }));
  return (
    <LineChart className="chart-frame" style={{ width: '100%', height: 240 }} responsive data={data} margin={CHART_MARGIN}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} width="auto" unit="%" />
      <Tooltip content={<ChartTip suffix="%" />} />
      <Line type="monotone" dataKey="rate" name="Rolling rate" stroke={CHART.purple} strokeWidth={2.5} dot={false} />
      <Line type="monotone" dataKey="expected" name="Uniform 6/49" stroke={CHART.blue} strokeDasharray="6 6" dot={false} />
    </LineChart>
  );
}

export function DashGrid({
  weeks = [],
  heatmapTitle = 'Draw activity',
  heatmapDetail,
  metrics = [],
  weekday = [],
  weekdayTitle = 'Activity by weekday',
  weekdayDetail,
  weekdayLeft = 'Draws',
  weekdayRight = 'Avg sum',
  months = [],
  monthTitle = '12-month activity',
  monthDetail,
  monthLeft = 'Draws',
  monthRight = 'Avg sum',
  mix = [],
  mixTitle = 'Draw mix',
  mixCaption = 'draws',
  bars = [],
  barsTitle = 'Numbers vs expected',
  extra = null
}) {
  const mixTotal = mix.reduce((total, slice) => total + Number(slice.value || 0), 0);

  return (
    <article className="dash">
      <section className="dash-heat chart-card">
        <header className="chart-card__head">
          <h2>{heatmapTitle}</h2>
          {heatmapDetail ? <p>{heatmapDetail}</p> : null}
        </header>
        <ActivityHeatmap weeks={weeks} />
      </section>

      <section className="dash-metrics">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="dash-weekday chart-card">
        <header className="chart-card__head">
          <h2>{weekdayTitle}</h2>
          {weekdayDetail ? <p>{weekdayDetail}</p> : null}
        </header>
        <WeekdayChart data={weekday} leftName={weekdayLeft} rightName={weekdayRight} />
      </section>

      <section className="dash-month chart-card">
        <header className="chart-card__head">
          <h2>{monthTitle}</h2>
          {monthDetail ? <p>{monthDetail}</p> : null}
        </header>
        <MonthTrendChart data={months} leftName={monthLeft} rightName={monthRight} />
      </section>

      <section className="dash-mix chart-card">
        <header className="chart-card__head">
          <h2>{mixTitle}</h2>
        </header>
        <MixDonut data={mix} total={mixTotal} caption={mixCaption} />
        <ul className="chart-legend">
          {mix.map((slice) => (
            <li key={slice.key}>
              <i style={{ background: slice.color }} />
              {slice.label} {(slice.share * 100).toFixed(1)}%
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-hot chart-card">
        <header className="chart-card__head">
          <h2>{barsTitle}</h2>
        </header>
        <NumberBars data={bars} />
      </section>

      {extra}
    </article>
  );
}

export function ActivityBoard({
  draws = [],
  stats = null,
  tickets = [],
  extra = null,
  recentSlot = null,
  onNumberClick,
  onOpenTicket
}) {
  const activity = buildActivity(draws, stats, tickets);
  const hitMode = activity.selected.length > 0;

  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapDetail={hitMode ? 'Green intensity is hits against your current tickets.' : 'Each cell is an official draw day.'}
      metrics={activity.metrics}
      weekday={activity.weekday}
      weekdayDetail={hitMode ? 'Draws vs average ticket hits.' : 'Draws vs average number sum.'}
      weekdayRight={hitMode ? 'Avg hits' : 'Avg sum'}
      months={activity.months}
      monthRight={hitMode ? 'Ticket hits' : 'Avg sum'}
      mix={activity.mix}
      bars={activity.numbers}
      extra={(
        <>
          {tickets.length ? (
            <section className="dash-tickets">
              <TicketStack tickets={tickets} onNumberClick={onNumberClick} onOpen={onOpenTicket} />
            </section>
          ) : null}
          {extra}
          {recentSlot}
        </>
      )}
    />
  );
}
