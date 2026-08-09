import { Calculator, Search, Sparkles } from 'lucide-react';
import { NumberPill, NumberRow } from './index';
import { formatDrawDate } from '../../lib/format';
import { Badge, Panel } from '../ui';

const SIGNAL_TONES = {
  hot: 'hot',
  cold: 'cold',
  overdue: 'overdue',
  neutral: 'default'
};

const SIGNAL_BAR_COLORS = {
  hot: 'bg-coral',
  overdue: 'bg-gold',
  default: 'bg-primary'
};

export function ScoreBreakdown({ components = {}, score, backtest }) {
  if (!components || !Object.keys(components).length) return null;
  const rows = [
    { key: 'hot', label: 'Hot signal', value: components.hot },
    { key: 'overdue', label: 'Overdue signal', value: components.overdue },
    { key: 'pair_strength', label: 'Pair strength', value: components.pair_strength },
    { key: 'spread', label: 'Number spread', value: components.spread },
    { key: 'balance', label: 'Odd/even balance', value: components.balance }
  ];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 items-end gap-3 rounded-2xl bg-elevated p-5">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-muted">Composite score</div>
          <div className="mt-1 text-4xl font-black text-ink">{Number(score || components.total || 0).toFixed(2)}</div>
        </div>
        {backtest ? (
          <div className="text-right">
            <div className="text-xs font-black uppercase tracking-wide text-muted">MC backtest</div>
            <div className="mt-1 text-2xl font-black text-secondary">{backtest.expected_match_score}</div>
            <div className="text-[10px] font-bold text-muted">{backtest.simulations} simulations</div>
          </div>
        ) : null}
      </div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.key} className="rounded-2xl bg-elevated px-4 py-3">
            <div className="mb-1 flex items-center justify-between text-xs font-black text-muted">
              <span>{row.label}</span>
              <span>{Number(row.value || 0).toFixed(1)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-field">
              <div
                className={`h-full rounded-full ${SIGNAL_BAR_COLORS[row.key] || SIGNAL_BAR_COLORS.default}`}
                style={{ width: `${Math.min(100, Math.max(6, row.value || 0))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NumberBreakdownTable({ rows = [] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">
        No per-number breakdown available for this result.
      </div>
    );
  }
  const isNoroc = rows[0]?.position != null;

  return (
    <div className="overflow-auto rounded-2xl border border-line">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="bg-field text-xs uppercase tracking-wide text-muted">
            {isNoroc ? (
              <>
                <th className="px-3 py-3">Pos</th>
                <th className="px-3 py-3">Digit</th>
              </>
            ) : (
              <th className="px-3 py-3">Number</th>
            )}
            <th className="px-3 py-3">Archive hits</th>
            <th className="px-3 py-3">Share</th>
            {!isNoroc ? <th className="px-3 py-3">Gap</th> : null}
            <th className="px-3 py-3">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={isNoroc ? row.position : row.number} className="border-t border-line hover:bg-field/70">
              {isNoroc ? (
                <>
                  <td className="px-3 py-3 font-black text-ink">P{row.position}</td>
                  <td className="px-3 py-3"><NumberPill value={row.digit} tone="bonus" size="sm" /></td>
                </>
              ) : (
                <td className="px-3 py-3"><NumberPill value={row.number} tone={SIGNAL_TONES[row.signal] || 'default'} size="sm" /></td>
              )}
              <td className="px-3 py-3 font-bold text-muted">{row.count}</td>
              <td className="px-3 py-3 font-bold text-muted">{row.share}%</td>
              {!isNoroc ? <td className="px-3 py-3 font-bold text-muted">{row.draws_since_seen}</td> : null}
              <td className="px-3 py-3"><Badge tone={row.signal === 'hot' ? 'coral' : row.signal === 'cold' ? 'teal' : row.signal === 'overdue' ? 'gold' : 'default'}>{row.signal}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatchHistogram({ histogram = [], totalDraws }) {
  const items = histogram.slice().sort((a, b) => String(a.match).localeCompare(String(b.match), undefined, { numeric: true }));
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="grid gap-3">
      {totalDraws ? (
        <div className="text-xs font-bold text-muted">Scanned {totalDraws.toLocaleString()} historical draws</div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.match} className="rounded-2xl bg-elevated p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-wide text-muted">Match {item.match}</div>
              <div className="text-right">
                <div className="text-lg font-black text-ink">{item.count}</div>
                <div className="text-[10px] font-bold text-secondary">{item.rate != null ? `${item.rate}%` : ''}</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineProfileStats({ profile }) {
  if (!profile) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl bg-elevated p-4"><div className="text-[10px] font-black uppercase text-muted">Sum</div><div className="mt-1 text-xl font-black">{profile.sum}</div></div>
      <div className="rounded-2xl bg-elevated p-4"><div className="text-[10px] font-black uppercase text-muted">Average</div><div className="mt-1 text-xl font-black">{profile.average}</div></div>
      <div className="rounded-2xl bg-elevated p-4"><div className="text-[10px] font-black uppercase text-muted">Odd / Even</div><div className="mt-1 text-xl font-black">{profile.odd_count} / {profile.even_count}</div></div>
      <div className="rounded-2xl bg-elevated p-4"><div className="text-[10px] font-black uppercase text-muted">Span</div><div className="mt-1 text-xl font-black">{profile.low} – {profile.high}</div></div>
    </div>
  );
}

export function AnalysisResults({ result }) {
  if (!result) return null;

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-line bg-field p-4">
        <div className="text-xs font-black uppercase tracking-wide text-muted">Analyzed line</div>
        <div className="mt-3">
          {result.code ? (
            <div className="font-mono text-3xl font-black tracking-[0.3em] text-ink">{result.code}</div>
          ) : (
            <NumberRow values={result.numbers} joker={result.joker} size="md" />
          )}
        </div>
      </div>

      <ScoreBreakdown components={result.components} score={result.score} backtest={result.backtest} />

      {result.profile?.sum != null ? <LineProfileStats profile={result.profile} /> : null}

      <NumberBreakdownTable rows={result.number_breakdown} />

      {result.histogram?.length ? (
        <div>
          <div className="mb-3 text-sm font-black text-ink">Historical match distribution</div>
          <MatchHistogram histogram={result.histogram} totalDraws={result.total_draws} />
        </div>
      ) : null}

      {result.best_match ? (
        <div className="rounded-2xl border border-secondary/20 bg-secondary/5 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-secondary">Best archive match</div>
          <div className="mt-2 text-sm font-black text-ink">
            {result.best_match.match_count} hits
            {result.best_match.joker_match ? ' + Joker' : ''} on {formatDrawDate(result.best_match.draw)}
          </div>
          <div className="mt-3">
            <NumberRow values={result.best_match.matched_numbers} size="sm" />
          </div>
        </div>
      ) : null}

      {result.algorithm ? (
        <div className="rounded-2xl border border-line bg-surface p-4 text-xs text-muted">
          <span className="font-black uppercase tracking-wide text-ink">Algorithm:</span> {result.algorithm.name}
          {result.algorithm.archive_draws || result.algorithm.history_draws ? ` · ${(result.algorithm.history_draws || result.algorithm.archive_draws).toLocaleString()} historical draws` : ''}
          {result.algorithm.simulations ? ` · ${result.algorithm.simulations} ticket simulations` : ''}
        </div>
      ) : null}
    </div>
  );
}

export function NumberCalculator({
  game,
  gameLabel,
  manualNumbers,
  setManualNumbers,
  manualJoker,
  setManualJoker,
  onCalculate,
  onAnalyze,
  calcLoading,
  analysisLoading,
  result,
  historyDraws = 0,
  onViewDetails
}) {
  return (
    <Panel title="Calculate & analyze" icon={Calculator}>
      <p className="text-sm leading-7 text-muted">
        Score any line against the <span className="font-black text-ink">{gameLabel}</span> archive ({historyDraws.toLocaleString()} draws) — results open in a detail panel.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          <input
            value={manualNumbers}
            onChange={(event) => setManualNumbers(event.target.value)}
            placeholder={game === 'joker' ? '5 numbers e.g. 3, 11, 19, 24, 33' : 'e.g. 3, 11, 19, 24, 33, 41'}
            className="w-full rounded-full border border-line bg-elevated px-5 py-3 text-sm font-semibold outline-none focus:border-primary"
          />
          {game === 'joker' ? (
            <input
              value={manualJoker}
              onChange={(event) => setManualJoker(event.target.value)}
              placeholder="Joker number 1-20"
              className="w-full rounded-full border border-line bg-elevated px-5 py-3 text-sm font-semibold outline-none focus:border-primary"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button type="button" onClick={onCalculate} disabled={calcLoading || analysisLoading} className="inline-flex items-center justify-center gap-2 rounded-full bg-elevated px-5 py-3 text-sm font-bold text-ink hover:text-primary disabled:opacity-40">
            <Calculator size={16} /> Quick score
          </button>
          <button type="button" onClick={onAnalyze} disabled={calcLoading || analysisLoading} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-field hover:bg-primary-light disabled:opacity-40">
            <Search size={16} /> Full analyze
          </button>
        </div>
      </div>

      {result ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-primary">Latest result</div>
            <div className="mt-1 text-2xl font-black text-ink">{Number(result.score || 0).toFixed(2)}</div>
          </div>
          {onViewDetails ? (
            <button type="button" onClick={onViewDetails} className="rounded-full bg-elevated px-4 py-2 text-sm font-bold text-ink hover:text-primary">
              View full details
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-field/70 px-4 py-6 text-center">
          <Sparkles className="mb-2 text-primary" size={20} />
          <div className="text-sm font-black text-ink">Enter numbers to start</div>
          <p className="mt-1 max-w-md text-xs text-muted">Quick score is instant. Full analyze scans every archive draw.</p>
        </div>
      )}
    </Panel>
  );
}
